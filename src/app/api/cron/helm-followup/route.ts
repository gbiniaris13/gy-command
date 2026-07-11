// GET /api/cron/helm-followup — daily. For each Sent request with a Gmail
// thread: (1) capture any new client reply (→ In Conversation, clear
// follow_up_at); (2) if still no reply and follow_up_at is past, create a
// ready-to-send FOLLOW-UP DRAFT inside the client's Gmail thread and ping
// George on Telegram. NOTHING is ever sent to the client automatically —
// the draft waits in Gmail Drafts for George's own Send button.
//
// Two stages, then silence (George's approved design 2026-07-09):
//   draft #1 at the Day-4 mark (follow_up_at set by /send = sent + 4d)
//   draft #2 six days later (the Day-10 graceful close)
//   after that follow_up_at is cleared — no infinite nagging.
// Stage state lives in settings (key helm_fu_stage_<id>) — no schema change.
//
// If draft creation fails we fall back to the old reminder email to George,
// so a Gmail hiccup never silently drops a follow-up.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { captureReplies } from "@/lib/helm/replies";
import { sendHelmEmail, createHelmDraft } from "@/lib/helm/gmail-send";
import { gmailFetch, getSetting, setSetting } from "@/lib/google-api";

export const runtime = "nodejs";
export const maxDuration = 60;

const REMINDER_TO = "george@georgeyachts.com";

type Row = {
  id: string;
  client_name: string | null;
  client_surname: string | null;
  client_title: string | null;
  client_email: string | null;
  email_subject: string | null;
  area: string | null;
  occasion: string | null;
  request_type: string | null;
  status: string;
  follow_up_at: string | null;
  gmail_thread_id: string | null;
  gmail_last_message_id: string | null;
  proposal_json: { yachts?: Array<{ name?: string }> } | null;
};

const junk = (s: string | null | undefined) =>
  !s || s.trim().length < 2 || s.trim() === "-" || s.trim() === "--";

function greeting(r: Row): string {
  if (!junk(r.client_surname)) {
    const title = r.client_title ? `${r.client_title.replace(/\.$/, "")}. ` : "";
    return `Dear ${title}${r.client_surname!.trim()},`;
  }
  if (!junk(r.client_name)) return `Dear ${r.client_name!.trim()},`;
  return "Hello,";
}

function displayName(r: Row): string {
  if (!junk(r.client_surname)) {
    return `${r.client_title ? r.client_title + ". " : ""}${r.client_surname!.trim()}`;
  }
  if (!junk(r.client_name)) return r.client_name!.trim();
  return r.client_email || "the client";
}

function yachtLine(r: Row): string | null {
  const names = (r.proposal_json?.yachts ?? [])
    .map((y) => (y?.name || "").trim())
    .filter(Boolean);
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  return `${names[0]} and the other options`;
}

// Follow-up copy. Deliberately template-based, NOT AI-generated: every
// sentence is fact-free by construction (no availability claims, no
// invented urgency, no numbers) so the no-invented-facts rule can never
// be violated. George edits freely before sending.
function buildBody(r: Row, stage: 1 | 2): string {
  const hello = greeting(r);
  const where = r.area && !junk(r.area) ? ` in ${r.area.trim()}` : "";
  const yl = yachtLine(r);
  const isAgent = r.request_type === "travel_agent";

  if (isAgent) {
    if (stage === 1) {
      return (
        `${hello}\n\n` +
        `Following up on the proposal I sent for your client's charter${where}. ` +
        `If the options need adjusting, different vessels, a revised budget frame, another routing, I can turn around an updated proposal the same day.\n\n` +
        `Happy to jump on a quick call as well if that is easier for you.\n\n` +
        `Best regards,`
      );
    }
    return (
      `${hello}\n\n` +
      `Closing the loop on this enquiry. The proposal stands as sent, and I can refresh the options whenever your client is ready to move.\n\n` +
      `If it has gone quiet on your side, no reply is needed. I remain at your disposal for the next one.\n\n` +
      `Best regards,`
    );
  }

  if (stage === 1) {
    return (
      `${hello}\n\n` +
      `I hope this finds you well. I wanted to make sure my proposal for your week${where} reached you comfortably${
        yl ? `, and that ${yl} gave you something worth dreaming about` : ""
      }.\n\n` +
      `If any detail deserves a second thought, the yacht, the route, the dates, tell me and I will reshape the proposal the same day. Nothing would please me more than getting this week exactly right for you.\n\n` +
      `Warm regards from Athens,`
    );
  }
  return (
    `${hello}\n\n` +
    `A short note only, I will not crowd your inbox. My proposal${where ? ` for your week${where}` : ""} remains open, and I remain at your disposal to adjust anything about it.\n\n` +
    `And if this season proves difficult, it would be my honour to plan a future week with you instead, with the whole fleet to choose from. One line from you is enough.\n\n` +
    `Warm regards from Athens,`
  );
}

// RFC Message-ID of the last message in the thread, so the draft threads
// correctly in the CLIENT's mail client too (Gmail threads by threadId,
// Outlook and others need In-Reply-To). Best effort — null on any failure.
async function lastMessageIdHeader(gmailMessageId: string | null): Promise<string | null> {
  if (!gmailMessageId) return null;
  try {
    const res = await gmailFetch(
      `/messages/${gmailMessageId}?format=metadata&metadataHeaders=Message-ID`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const h = (data?.payload?.headers ?? []).find(
      (x: { name?: string }) => x.name?.toLowerCase() === "message-id",
    );
    return h?.value ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const { data: rows, error } = await db
    .from("helm_requests")
    .select(
      "id, client_name, client_surname, client_title, client_email, email_subject, area, occasion, request_type, status, follow_up_at, gmail_thread_id, gmail_last_message_id, proposal_json",
    )
    .eq("status", "sent")
    .not("gmail_thread_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  let replies = 0;
  let drafts = 0;
  let fallbacks = 0;

  for (const r of (rows || []) as Row[]) {
    // 1) Capture replies first — may move the request to in_conversation.
    let cap = { newReplies: 0 };
    try {
      cap = await captureReplies(r.id);
    } catch (e) {
      console.error("[helm-followup] captureReplies failed", r.id, e);
    }
    if (cap.newReplies > 0) {
      replies++;
      continue; // got a reply → no follow-up needed
    }

    // 2) No reply and the follow-up mark has passed → prepare the draft.
    if (!r.follow_up_at || new Date(r.follow_up_at).getTime() > now) continue;
    if (!r.client_email || junk(r.client_email)) continue;

    const stageKey = `helm_fu_stage_${r.id}`;
    const prior = parseInt((await getSetting(stageKey)) || "0", 10) || 0;
    if (prior >= 2) {
      // Both follow-ups already drafted — stop rescanning this request.
      await db
        .from("helm_requests")
        .update({ follow_up_at: null, updated_at: new Date().toISOString() })
        .eq("id", r.id);
      continue;
    }
    const stage = (prior + 1) as 1 | 2;

    const baseSubject = r.email_subject?.trim() || "Your charter proposal";
    const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;
    const name = displayName(r);
    const yl = yachtLine(r);

    try {
      const inReplyTo = await lastMessageIdHeader(r.gmail_last_message_id);
      await createHelmDraft({
        to: r.client_email,
        subject,
        body: buildBody(r, stage),
        threadId: r.gmail_thread_id || undefined,
        inReplyTo: inReplyTo || undefined,
      });
      drafts++;

      await setSetting(stageKey, String(stage));
      await db
        .from("helm_requests")
        .update({
          // stage 1 → second mark six days later (the Day-10 close);
          // stage 2 → done, stop.
          follow_up_at:
            stage === 1 ? new Date(now + 6 * 24 * 60 * 60 * 1000).toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id);

      try {
        const { sendTelegram } = await import("@/lib/telegram");
        await sendTelegram(
          [
            `📮 <b>The Helm — follow-up draft ${stage}/2 ready</b>`,
            `${name}${yl ? ` · ${yl}` : ""}${r.area && !junk(r.area) ? ` · ${r.area}` : ""}`,
            `Waiting in Gmail → Drafts. Read it, adjust if you like, press Send.`,
            `Nothing has been sent to the client.`,
          ].join("\n"),
        );
      } catch (e) {
        console.error("[helm-followup] telegram ping failed", r.id, e);
      }
    } catch (e) {
      console.error("[helm-followup] draft failed", r.id, e);
      // Fallback: the old internal reminder email, so the follow-up is
      // never silently dropped.
      try {
        await sendHelmEmail({
          to: REMINDER_TO,
          subject: `Follow up: ${name} - no reply yet on your charter proposal`,
          body:
            `Reminder from The Helm.\n\n` +
            `${name} has not replied to the proposal you sent, and the automatic follow-up draft could not be created (${(e as Error).message?.slice(0, 120)}).\n\n` +
            `Open the request in GY Command to see the thread and reply by hand. ` +
            `Nothing has been sent to the client.\n\n` +
            `Warmly,\nThe Helm`,
        });
        fallbacks++;
        await db
          .from("helm_requests")
          .update({
            follow_up_at: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
      } catch (e2) {
        console.error("[helm-followup] fallback reminder failed", r.id, e2);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: rows?.length || 0,
    replies,
    drafts,
    fallbacks,
  });
}
