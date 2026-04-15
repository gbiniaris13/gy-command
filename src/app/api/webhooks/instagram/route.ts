// @ts-nocheck
import { NextRequest } from "next/server";
import { aiChat } from "@/lib/ai";
import { createNotification } from "@/lib/notifications";
import { sendTelegram } from "@/lib/telegram";

// Best-effort lookup for a sender's @username. Instagram webhook payloads
// only contain the numeric user id, so we resolve the handle via a Graph
// API call before we build the Telegram message. Failures fall back to the
// raw id so notifications keep firing.
async function resolveIgUsername(
  userId: string,
  accessToken: string
): Promise<string> {
  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/${userId}?fields=username&access_token=${accessToken}`
    );
    if (!res.ok) return userId;
    const json = await res.json();
    return json?.username ? `@${json.username}` : userId;
  } catch {
    return userId;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const VERIFY_TOKEN = "gy_command_webhook_2026";

// ─── DM Auto-Reply Templates ────────────────────────────────────────────────

const DM_TEMPLATES: Record<string, string> = {
  charter_inquiry:
    "Thank you for your interest in George Yachts! ⚓ You can explore our fleet at georgeyachts.com or book a free consultation: calendly.com/george-georgeyachts/30min\n\nWe'd love to help plan your Greek island charter!",
  pricing:
    "Great question! Charter rates vary by yacht type, season, and duration. Visit our cost calculator at georgeyachts.com/cost-calculator for instant estimates, or let's connect: calendly.com/george-georgeyachts/30min",
  general:
    "Thank you for reaching out to George Yachts! ⚓🇬🇷 How can we help you? Feel free to explore georgeyachts.com or book a call with our team: calendly.com/george-georgeyachts/30min\n\nFair winds!",
};

const DM_CLASSIFY_PROMPT = `You are classifying Instagram DMs for George Yachts, a luxury yacht charter brokerage in Greece.
Classify the user's message into ONE of these categories:
- charter_inquiry (asking about charters, yacht availability, trips, destinations, Greece sailing)
- pricing (asking about costs, prices, rates, budget, how much)
- general (greetings, thank you, anything else)

Respond with ONLY the category name, nothing else.`;

// Warm welcome prefix prepended to the very first DM reply a sender ever
// receives from us. Mirrors the short line George wanted for new followers
// — Instagram's messaging policy forces us to deliver it on first inbound
// message instead of on follow.
const FIRST_MESSAGE_WELCOME =
  "Hey! Thanks for the follow 🙏 If you're ever thinking about Greece by sea, I'm here.\n\n";

// Auto-reply to story mentions. Instagram delivers story mentions as an
// inbound message with an attachment of type "story_mention" — they come
// through the same messages webhook as normal DMs, just with the sticker
// payload attached. The Messaging API 24-hour window is opened by the
// mention itself, so a reply is allowed immediately.
const STORY_MENTION_REPLY =
  "Thanks for the mention! 🙌 Love seeing Greece through your eyes. If you ever want to take it to the next level — yacht, crew, islands — you know where to find us. 🚢";

// Rate limit for story-mention auto-replies, per user.
const STORY_MENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// GET — Webhook verification
// Facebook sends: ?hub.mode=subscribe&hub.verify_token=XXX&hub.challenge=YYY
export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  // Try both searchParams and manual parsing (Facebook encodes dots)
  const mode = url.searchParams.get("hub.mode") ?? url.searchParams.get("hub%2Emode");
  const token = url.searchParams.get("hub.verify_token") ?? url.searchParams.get("hub%2Everify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? url.searchParams.get("hub%2Echallenge");

  console.log("[IG Webhook] Verify request:", { mode, token, challenge, fullUrl: request.url });

  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    // Facebook requires the challenge as the ENTIRE response body, plain text, 200
    return new Response(challenge, { status: 200 });
  }

  // If token doesn't match, log what we got vs expected
  console.log("[IG Webhook] Token mismatch:", { got: token, expected: VERIFY_TOKEN });
  return new Response(`Forbidden - token mismatch`, { status: 403 });
}

// POST — Receive webhook events
export async function POST(request: NextRequest) {
  const body = await request.json();
  const igToken = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return Response.json({ status: "no config" });
  }

  const { createServiceClient } = await import("@/lib/supabase-server");
  const sb = createServiceClient();

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      // NOTE: Instagram Graph API does not emit a `followers` webhook and
      // the Messaging API refuses cold DMs to users who have not opened a
      // conversation with the page. The welcome flow lives on the `messages`
      // branch below instead — the first time a user DMs us, we prepend a
      // warm welcome before the AI-classified reply template.

      // Comment auto-reply — Feature #4: AI contextual reply to ALL
      // genuine comments. Gemini classifies each new comment as
      // genuine / spam / emoji-only and, when genuine, generates a
      // short warm reply in George Biniaris voice. Spam + emoji-only
      // get silently ignored (never reply to bots — kills engagement
      // ratio). Race-safe via the ig_comment_replies UNIQUE(comment_id)
      // mutex: we INSERT a claim row first, and if the DB rejects it
      // as a duplicate, another webhook delivery is already handling
      // the same comment and we silently exit.
      if (change.field === "comments") {
        // 🚨 HARD DISABLE — the earlier Feature #4 SELECT-before-INSERT
        // dedup loses every race against parallel webhook deliveries
        // and Instagram's own event retries, which produced a 10+ reply
        // spam on a single @eleanna_karvouni "Stunning 👏" comment.
        // This branch is locked off until the race-safe
        // ig_comment_replies UNIQUE(comment_id) mutex lands in the next
        // commit. ANY return to auto-replying goes through that path.
        continue;

        // @ts-expect-error — unreachable until re-enabled below
        const commentRaw = (change.value?.text ?? "").trim();
        const commentId = change.value?.id;
        const commenterId = change.value?.from?.id;
        const commenterUsername = change.value?.from?.username;
        const parentMediaId = change.value?.media?.id;

        if (!commentId || !commentRaw) continue;

        try {
          // Dedup — don't reply twice to the same comment id even if
          // Instagram re-delivers the webhook
          const { data: dupeRows } = await sb
            .from("ig_dm_replies")
            .select("id")
            .eq("sender_id", `comment:${commentId}`)
            .limit(1);
          if (dupeRows && dupeRows.length > 0) continue;

          // Per-commenter 24h rate limit — if we already replied to a
          // comment from this user in the last 24h, stay quiet so we
          // don't look spammy.
          if (commenterId) {
            const { data: recent } = await sb
              .from("ig_dm_replies")
              .select("id")
              .eq("sender_id", `commenter:${commenterId}`)
              .gte("sent_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
              .limit(1);
            if (recent && recent.length > 0) continue;
          }

          // Fetch the parent post caption so the AI can be contextual
          let postCaption = "";
          if (parentMediaId) {
            try {
              const capRes = await fetch(
                `https://graph.instagram.com/v21.0/${parentMediaId}?fields=caption&access_token=${encodeURIComponent(igToken)}`
              );
              const capJson = await capRes.json();
              postCaption = (capJson?.caption ?? "").slice(0, 800);
            } catch {
              /* non-fatal */
            }
          }

          const classifyPrompt = `Classify this Instagram comment and, if it's genuine engagement, write a reply from George Biniaris voice.

POST CAPTION:
${postCaption || "(unavailable)"}

COMMENT (from @${commenterUsername ?? "unknown"}):
"${commentRaw.slice(0, 400)}"

Classification options:
A) genuine — a real question, compliment, interest, or substantive reaction
B) spam — promotional, bot-like, link farming, completely irrelevant
C) emoji — only emojis / reactions with no text

Rules for the reply when classification is "genuine":
- 1-2 sentences max
- Warm but professional, George Biniaris voice
- NEVER just "Thanks!" / "Appreciate it!" — add a small, specific insight about Greek waters, the yacht, or the topic
- NEVER include links or business names
- NEVER mention pricing, bookings, or selling
- If the comment is a compliment, thank them but add one personal note
- If the comment is a question, give a brief genuine answer

Return ONLY valid JSON:
{"action": "reply" | "skip", "reply": "..."}`;

          let aiVerdict: { action?: string; reply?: string } = {};
          try {
            const raw = await aiChat(
              "You classify Instagram comments and return only JSON. No markdown.",
              classifyPrompt
            );
            const m = raw.match(/\{[\s\S]*\}/);
            if (m) aiVerdict = JSON.parse(m[0]);
          } catch {
            // If AI fails, fall back to the legacy keyword matcher so
            // we never silently go dark on price/booking questions.
          }

          // Legacy keyword fallback if AI didn't produce a verdict
          if (!aiVerdict.action) {
            const lower = commentRaw.toLowerCase();
            const priceWords = ["price", "cost", "how much", "rate"];
            const bookWords = ["book", "reserve", "available"];
            if (priceWords.some((w) => lower.includes(w))) {
              aiVerdict = {
                action: "reply",
                reply:
                  "Charter rates shift a lot with yacht, dates and length — happy to put real numbers against yours in a DM.",
              };
            } else if (bookWords.some((w) => lower.includes(w))) {
              aiVerdict = {
                action: "reply",
                reply:
                  "Send us your ideal week and guest count in a DM and we'll come back with a proper shortlist.",
              };
            }
          }

          if (aiVerdict.action !== "reply" || !aiVerdict.reply) {
            // Log the skip so we don't reclassify this comment next delivery
            await sb
              .from("ig_dm_replies")
              .insert({
                sender_id: `comment:${commentId}`,
                message_text: commentRaw,
                intent: "comment_skip",
                reply_text: "",
                sent_at: new Date().toISOString(),
              })
              .catch(() => {});
            continue;
          }

          const replyText = String(aiVerdict.reply).trim().slice(0, 500);

          await fetch(
            `https://graph.instagram.com/v21.0/${commentId}/replies`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: replyText, access_token: igToken }),
            }
          ).catch(() => {});

          // Two rate-limit records: one per comment id (idempotency),
          // one per commenter id (24h cooldown). Both point at the
          // same reply text for audit.
          await sb
            .from("ig_dm_replies")
            .insert([
              {
                sender_id: `comment:${commentId}`,
                message_text: commentRaw,
                intent: "comment_reply",
                reply_text: replyText,
                sent_at: new Date().toISOString(),
              },
              ...(commenterId
                ? [
                    {
                      sender_id: `commenter:${commenterId}`,
                      message_text: commentRaw,
                      intent: "comment_reply",
                      reply_text: replyText,
                      sent_at: new Date().toISOString(),
                    },
                  ]
                : []),
            ])
            .catch(() => {});

          await sendTelegram(
            `💬 <b>Auto-replied to comment</b> from @${escapeHtml(commenterUsername ?? commenterId ?? "unknown")}\n<i>"${escapeHtml(commentRaw.slice(0, 120))}"</i>\n→ ${escapeHtml(replyText.slice(0, 150))}`
          ).catch(() => {});
        } catch (err) {
          console.error("[IG Webhook] Comment auto-reply error:", err);
        }
      }

      // DM auto-reply
      if (change.field === "messages") {
        const messaging = change.value;
        const senderId = messaging?.sender?.id;
        const messageText = messaging?.message?.text;

        // Skip if it's our own message (echo)
        if (!senderId || senderId === igId) continue;

        // Resolve the sender's @username once so every downstream
        // notification uses the same friendly handle.
        const handle = await resolveIgUsername(senderId, igToken);

        // ── Story mention branch ─────────────────────────────────────
        // Instagram delivers "@georgeyachts was mentioned in a Story"
        // as an inbound message with an attachment whose type is
        // "story_mention". We handle these before the regular DM flow
        // so the 7-day rate limiter doesn't collide with the 24h DM
        // rate limiter and the reply template is distinct.
        const attachments = Array.isArray(messaging?.message?.attachments)
          ? messaging.message.attachments
          : [];
        const storyMention = attachments.find(
          (a) => a?.type === "story_mention"
        );
        if (storyMention) {
          try {
            const cutoff = new Date(Date.now() - STORY_MENTION_WINDOW_MS).toISOString();
            const { data: recentStoryReplies } = await sb
              .from("ig_dm_replies")
              .select("id")
              .eq("sender_id", senderId)
              .eq("intent", "story_mention")
              .gte("sent_at", cutoff)
              .limit(1);

            if (recentStoryReplies && recentStoryReplies.length > 0) {
              // Still send the heads-up so George sees it in Telegram,
              // just don't auto-reply again within the window.
              await sendTelegram(
                `🎬 <b>Story mention from ${escapeHtml(handle)}</b>\n<i>skipping auto-reply (already replied within 7 days)</i>`
              ).catch(() => {});
              continue;
            }

            // Story mention payload carries the mentioned story's
            // media URL in the attachment. Grab it so we can re-share.
            const storyMediaUrl =
              storyMention.payload?.url ??
              storyMention.payload?.image_url ??
              null;

            // 1. Thank-you DM back to the sender
            await fetch(`https://graph.instagram.com/v21.0/me/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                recipient: { id: senderId },
                message: { text: STORY_MENTION_REPLY },
                access_token: igToken,
              }),
            });

            // 2. Feature #6 — auto-repost to our own Story using the
            // Content Publishing API. Two steps: create a media
            // container with media_type=STORIES, then publish it.
            // Skips gracefully if the media URL isn't available or
            // the publish fails (permissions vary per IG account).
            let repostResult: {
              ok: boolean;
              media_id?: string;
              reason?: string;
            } = { ok: false, reason: "no media url" };

            if (storyMediaUrl) {
              try {
                const createRes = await fetch(
                  `https://graph.instagram.com/v21.0/me/media`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      image_url: storyMediaUrl,
                      media_type: "STORIES",
                      access_token: igToken,
                    }),
                  }
                );
                const createJson = await createRes.json();
                if (createJson?.id) {
                  // Quick status poll — story media processes fast
                  let ready = false;
                  for (let attempt = 0; attempt < 5; attempt++) {
                    await new Promise((r) => setTimeout(r, 2000));
                    const statusRes = await fetch(
                      `https://graph.instagram.com/v21.0/${createJson.id}?fields=status_code&access_token=${encodeURIComponent(igToken)}`
                    );
                    const statusJson = await statusRes.json();
                    if (statusJson?.status_code === "FINISHED") {
                      ready = true;
                      break;
                    }
                    if (statusJson?.status_code === "ERROR") break;
                  }

                  if (ready) {
                    const publishRes = await fetch(
                      `https://graph.instagram.com/v21.0/me/media_publish`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          creation_id: createJson.id,
                          access_token: igToken,
                        }),
                      }
                    );
                    const publishJson = await publishRes.json();
                    if (publishJson?.id) {
                      repostResult = { ok: true, media_id: publishJson.id };
                    } else {
                      repostResult = {
                        ok: false,
                        reason:
                          publishJson?.error?.message ?? "publish failed",
                      };
                    }
                  } else {
                    repostResult = { ok: false, reason: "container not ready" };
                  }
                } else {
                  repostResult = {
                    ok: false,
                    reason: createJson?.error?.message ?? "container create failed",
                  };
                }
              } catch (err) {
                repostResult = {
                  ok: false,
                  reason: err instanceof Error ? err.message : "reshare exception",
                };
              }
            }

            // 3. Telegram alert — tell George what happened (DM sent,
            // reshare success/fail)
            await sendTelegram(
              repostResult.ok
                ? `🎬 <b>Story mention from ${escapeHtml(handle)}</b>\n✓ Thank-you DM sent\n✓ Reshared to our Story (media id ${repostResult.media_id})`
                : `🎬 <b>Story mention from ${escapeHtml(handle)}</b>\n✓ Thank-you DM sent\n✗ Reshare skipped: ${escapeHtml(repostResult.reason ?? "unknown")}`
            ).catch(() => {});

            await sb
              .from("ig_dm_replies")
              .insert({
                sender_id: senderId,
                message_text: messageText ?? "[story mention]",
                intent: "story_mention",
                reply_text: STORY_MENTION_REPLY,
                sent_at: new Date().toISOString(),
              })
              .catch(() => {});

            await createNotification(sb, {
              type: "ig_dm",
              title: `🎬 Story mention from ${handle}`,
              description: repostResult.ok
                ? "Auto-replied + reshared to our Story"
                : `Auto-replied · reshare: ${repostResult.reason}`,
              link: "/dashboard/instagram",
            });
          } catch (err) {
            console.error("[IG Webhook] Story mention reply error:", err);
          }
          continue;
        }

        // Skip plain DMs with no text (e.g. unsupported media without
        // a story-mention attachment we can't reply to anyway).
        if (!messageText) continue;

        // IMMEDIATE Telegram alert — fires for EVERY inbound DM so George
        // sees activity in real time, even if the auto-reply rate limiter
        // later decides to stay quiet.
        const preview =
          messageText.length > 200 ? messageText.slice(0, 200) + "…" : messageText;
        await sendTelegram(
          `🟢 <b>IG DM from ${escapeHtml(handle)}</b>\n${escapeHtml(preview)}`
        ).catch(() => {});

        try {
          // Look up the sender's entire history with us in one query so we
          // can answer two questions cheaply:
          //   1. Did we already auto-reply in the last 24h? (rate limit)
          //   2. Have we EVER replied to this sender? (first-message welcome)
          const { data: history } = await sb
            .from("ig_dm_replies")
            .select("id, sent_at")
            .eq("sender_id", senderId)
            .order("sent_at", { ascending: false })
            .limit(5);

          const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
          const repliedInLast24h = (history ?? []).some(
            (r) => new Date(r.sent_at).getTime() >= dayAgo
          );
          if (repliedInLast24h) continue; // Already replied in last 24h

          // First-ever contact if no history row exists at all.
          const isFirstMessage = !history || history.length === 0;

          // Classify intent via AI
          let intent = "general";
          try {
            const classification = await aiChat(DM_CLASSIFY_PROMPT, messageText);
            const cleaned = classification.trim().toLowerCase();
            if (cleaned in DM_TEMPLATES) intent = cleaned;
          } catch {
            intent = "general"; // Fallback if AI fails
          }

          const baseReply = DM_TEMPLATES[intent] || DM_TEMPLATES.general;
          const reply = isFirstMessage
            ? FIRST_MESSAGE_WELCOME + baseReply
            : baseReply;

          // Send reply via Instagram Send API
          await fetch(`https://graph.instagram.com/v21.0/me/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id: senderId },
              message: { text: reply },
              access_token: igToken,
            }),
          });

          // Log for rate limiting
          await sb.from("ig_dm_replies").insert({
            sender_id: senderId,
            message_text: messageText,
            intent,
            reply_text: reply,
            sent_at: new Date().toISOString(),
          }).catch(() => {});

          // Second Telegram alert — confirms the auto-reply actually fired,
          // so George can take over manually whenever he wants. Flag first-
          // time contacts explicitly so George knows a welcome just went out.
          await sendTelegram(
            isFirstMessage
              ? `🤖 <b>Welcomed + auto-replied to ${escapeHtml(handle)}</b>\n<i>first contact · intent:</i> ${escapeHtml(intent)}`
              : `🤖 <b>Auto-replied to ${escapeHtml(handle)}</b>\n<i>intent:</i> ${escapeHtml(intent)}`
          ).catch(() => {});

          // Dashboard notification so George sees the DM in the bell
          await createNotification(sb, {
            type: "ig_dm",
            title: `📩 New Instagram DM from ${handle} (${intent.replace("_", " ")})`,
            description:
              messageText.length > 140
                ? messageText.slice(0, 140) + "…"
                : messageText,
            link: "/dashboard/instagram",
          });
        } catch (err) {
          console.error("[IG Webhook] DM reply error:", err);
        }
      }
    }
  }

  return Response.json({ status: "ok" });
}
