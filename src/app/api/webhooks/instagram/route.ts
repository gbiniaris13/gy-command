// @ts-nocheck
// Instagram webhook: comments on our posts, and direct messages.
//
// Rewritten 2026-11-19 (George, after the Instagram research). This file
// used to answer people by itself in three ways: a model wrote replies to
// comments in a brand voice, direct messages got one of three canned
// texts with a booking link "with our team", and a story mention got a
// thank-you with emoji. All of that is gone. George answers every message
// himself. The rules for the two things the account may still say on its
// own, and their exact words, are in src/lib/ig-inbox.ts:
//
//   - a night note (00:00 to 08:00 Athens), once per person per week,
//     openly automatic and signed;
//   - one private message to a comment that is one of the words a post
//     asked for ("COST", "TEN"), with what the post promised.
//
// Everything that arrives is told to George on Telegram, logged
// (ig_comment_replies, ig_dm_replies) and shown in the dashboard's
// notifications. Nothing public is ever posted from here.
//
// The calls go through graph.facebook.com with the same long-lived token
// the publishing crons use. The old IG_ACCESS_TOKEN this file depended on
// stopped working in 2026 and took the auto-replies with it; whether
// messages can be sent at all depends on the Meta app holding
// instagram_manage_messages (see /api/admin/ig-inbox-check).

import { NextRequest } from "next/server";
import { createNotification } from "@/lib/notifications";
import { sendTelegram } from "@/lib/telegram";
import { checkRateLimitHealth, logRateLimitAction } from "@/lib/rate-limit-guard";
import { getIgTokenOptional } from "@/lib/ig-token";
import { isAthensNight, awayNote, keywordIn, privateReply, hasWords } from "@/lib/ig-inbox";

export const maxDuration = 60;

const VERIFY_TOKEN = "gy_command_webhook_2026";
const GRAPH = "https://graph.facebook.com/v21.0";
const NOTE_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Comments that are a scraper's hook, not a person: never worth a ping. */
function isLikelyScraperSpam(commentText: string, commenterUsername: string | null): boolean {
  const text = (commentText ?? "").trim().toLowerCase();
  const user = (commenterUsername ?? "").toLowerCase();
  if (!text) return false;
  if (/\bsend\s+(?:me|to\s+me)\s+(?:this|the\s+)?post\b|\bsend\s+it\s+to\s+me\b|\bdm\s+me\s+this\b|\bshare\s+(?:it|this)\s+to\s+me\b/.test(text)) return true;
  if (/^link\s+in\s+bio\s*\??$/i.test(text)) return true;
  const botUser = [/_buzz$/, /_daily$/, /^travel_\w+_\d+$/, /^luxury_\w+_\w+$/, /^\w+_vibes(_\w+)?$/, /^\w+city_\w+$/, /\d{4,}$/].some((p) => p.test(user));
  return botUser && text.length < 50 && /\b(?:beautiful|amazing|stunning|incredible|wow|gorgeous|lovely|perfect|nice)\b/i.test(text);
}

// The Page's own token, needed for messages. The stored token may be a
// system user's; the Page token is derived from it once per invocation.
let _pageToken: string | null = null;
async function pageToken(base: string): Promise<string> {
  if (_pageToken) return _pageToken;
  const pageId = process.env.FB_PAGE_ID;
  if (pageId) {
    try {
      const res = await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${encodeURIComponent(base)}`);
      const j = await res.json();
      if (j?.access_token) {
        _pageToken = j.access_token;
        return _pageToken as string;
      }
    } catch {}
  }
  return base;
}

/** One message to one person or one comment. Says honestly whether it went. */
async function sendMessage(recipient: { id: string } | { comment_id: string }, text: string): Promise<{ ok: boolean; error?: string }> {
  const base = getIgTokenOptional();
  if (!base) return { ok: false, error: "no token" };
  if (!(await checkRateLimitHealth("dm_send"))) return { ok: false, error: "rate limit" };
  try {
    const token = await pageToken(base);
    const target = process.env.FB_PAGE_ID || "me";
    const res = await fetch(`${GRAPH}/${target}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient, message: { text }, access_token: token }),
    });
    const j = await res.json().catch(() => ({}));
    if (j?.message_id || j?.recipient_id) {
      await logRateLimitAction("dm_send", { kind: "comment_id" in recipient ? "private_reply" : "away_note" });
      return { ok: true };
    }
    return { ok: false, error: String(j?.error?.message ?? `HTTP ${res.status}`).slice(0, 240) };
  } catch (e) {
    return { ok: false, error: String((e as any)?.message ?? e).slice(0, 240) };
  }
}

async function usernameOf(userId: string): Promise<string> {
  const base = getIgTokenOptional();
  if (!base) return userId;
  try {
    const token = await pageToken(base);
    const res = await fetch(`${GRAPH}/${userId}?fields=username,name&access_token=${encodeURIComponent(token)}`);
    const j = await res.json();
    return j?.username ? `@${j.username}` : j?.name ? String(j.name) : userId;
  } catch {
    return userId;
  }
}

// GET: Meta's verification handshake.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode") ?? url.searchParams.get("hub%2Emode");
  const token = url.searchParams.get("hub.verify_token") ?? url.searchParams.get("hub%2Everify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? url.searchParams.get("hub%2Echallenge");
  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    // The challenge must be the entire body, plain text.
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

async function onComment(sb: any, igId: string, value: any) {
  const text = String(value?.text ?? "").trim();
  const commentId = value?.id;
  const fromId = value?.from?.id;
  const username = value?.from?.username ?? null;
  const mediaId = value?.media?.id ?? null;
  if (!commentId || !text) return;
  // Our own comments (the first comment under each post) come back here too.
  if ((fromId && String(fromId) === String(igId)) || String(username ?? "").toLowerCase() === "georgeyachts") return;

  // One row per comment: a second delivery of the same event stops here.
  const { error: claimError } = await sb.from("ig_comment_replies").insert({
    comment_id: commentId,
    post_id: mediaId,
    commenter_id: fromId ?? null,
    commenter_username: username,
    comment_text: text.slice(0, 1000),
    status: "claimed",
  });
  if (claimError) return;
  const mark = (fields: Record<string, unknown>) => sb.from("ig_comment_replies").update(fields).eq("comment_id", commentId);

  const keyword = keywordIn(text);
  if (keyword) {
    const reply = privateReply(keyword)!;
    const sent = await sendMessage({ comment_id: commentId }, reply);
    await mark({
      // "posted" here means the private note was delivered (the table's
      // older rows use the same word for a public reply; none is made now).
      status: sent.ok ? "posted" : "failed",
      reply_text: reply,
      error: sent.ok ? null : sent.error,
      replied_at: sent.ok ? new Date().toISOString() : null,
    });
    await sendTelegram(
      `💬 <b>@${escapeHtml(username ?? "someone")} commented "${escapeHtml(text.slice(0, 80))}"</b>\n` +
        (sent.ok
          ? `The automatic private note for ${keyword} went to them. If they answer it, the conversation is yours.`
          : `The automatic private note for ${keyword} could NOT be sent (${escapeHtml(sent.error ?? "unknown")}). Message them yourself.`),
    ).catch(() => {});
    return;
  }

  if (isLikelyScraperSpam(text, username)) {
    await mark({ status: "scraper_spam", reply_text: "", error: "scraper hook" });
    return;
  }
  if (!hasWords(text)) {
    await mark({ status: "skipped", reply_text: "", error: "emoji only" });
    return;
  }

  // A person said something. George answers it; the account does not.
  await mark({ status: "skipped", reply_text: "", error: "left for George to answer" });
  await sendTelegram(
    `💬 <b>Comment from @${escapeHtml(username ?? "someone")}</b>\n"${escapeHtml(text.slice(0, 400))}"\n\nNothing was answered for you. Reply in Instagram.`,
  ).catch(() => {});
  await createNotification(sb, {
    type: "ig_dm",
    title: `💬 Comment from @${username ?? "someone"}`,
    description: text.slice(0, 200),
    link: "/dashboard/instagram",
  });
}

async function onMessage(sb: any, igId: string, messaging: any) {
  const senderId = messaging?.sender?.id;
  const message = messaging?.message;
  // Echoes of our own messages, read receipts, reactions and deletions are not messages.
  if (!senderId || String(senderId) === String(igId) || !message || message.is_echo || message.is_deleted) return;

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const storyMention = attachments.some((a: any) => a?.type === "story_mention");
  const text = String(message.text ?? "").trim();
  if (!text && !attachments.length) return;
  const handle = await usernameOf(String(senderId));
  const shown = text || (storyMention ? "[mentioned you in their story]" : "[sent an attachment]");

  // The night note: only at night in Athens, only to a written message,
  // only if this person has not had one in the last week.
  let note: { sent: boolean; error?: string } | null = null;
  const now = new Date();
  if (text && isAthensNight(now)) {
    let already = false;
    try {
      const { data } = await sb
        .from("ig_dm_replies")
        .select("id")
        .eq("sender_id", senderId)
        .eq("intent", "away_note")
        .gte("sent_at", new Date(now.getTime() - NOTE_EVERY_MS).toISOString())
        .limit(1);
      already = Boolean(data && data.length);
    } catch {}
    if (!already) {
      const sent = await sendMessage({ id: String(senderId) }, awayNote(now));
      note = { sent: sent.ok, error: sent.error };
    }
  }

  try {
    await sb.from("ig_dm_replies").insert({
      sender_id: senderId,
      message_text: shown.slice(0, 2000),
      intent: note?.sent ? "away_note" : storyMention ? "story_mention" : "inbound",
      reply_text: note?.sent ? awayNote(now) : null,
      sent_at: now.toISOString(),
    });
  } catch {}

  const noteLine = !note
    ? "Nothing was answered for you. Reply in Instagram."
    : note.sent
      ? "It is night in Athens: the automatic note went (promising your reply by 09:00). Nothing else was said."
      : `It is night in Athens, but the automatic note could NOT be sent (${escapeHtml(note.error ?? "unknown")}).`;
  await sendTelegram(
    `${storyMention ? "🎬" : "📩"} <b>Instagram ${storyMention ? "story mention" : "message"} from ${escapeHtml(handle)}</b>\n"${escapeHtml(shown.slice(0, 600))}"\n\n${noteLine}`,
  ).catch(() => {});
  await createNotification(sb, {
    type: "ig_dm",
    title: `${storyMention ? "🎬 Story mention" : "📩 Instagram message"} from ${handle}`,
    description: shown.slice(0, 200),
    link: "/dashboard/instagram",
  });
}

// POST: events.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ status: "bad body" }, { status: 400 });
  }
  const igId = process.env.IG_BUSINESS_ID;
  if (!igId) return Response.json({ status: "no config" });

  const { createServiceClient } = await import("@/lib/supabase-server");
  const sb = createServiceClient();

  for (const entry of body?.entry ?? []) {
    // Messages arrive either as entry.messaging[] or as a "messages"
    // change, depending on which Instagram product delivers them.
    for (const m of entry.messaging ?? []) {
      try {
        await onMessage(sb, igId, m);
      } catch (e) {
        console.error("[IG Webhook] message failed:", e);
      }
    }
    for (const change of entry.changes ?? []) {
      try {
        if (change.field === "comments") await onComment(sb, igId, change.value);
        else if (change.field === "messages") await onMessage(sb, igId, change.value);
      } catch (e) {
        console.error("[IG Webhook] change failed:", e);
      }
    }
  }
  // Always 200: Meta retries anything else, and a retry of a handled event is noise.
  return Response.json({ status: "ok" });
}
