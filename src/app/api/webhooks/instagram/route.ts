// @ts-nocheck
import { NextRequest } from "next/server";
import { aiChat } from "@/lib/ai";
import { createNotification } from "@/lib/notifications";
import { sendTelegram } from "@/lib/telegram";
import {
  checkRateLimitHealth,
  logRateLimitAction,
} from "@/lib/rate-limit-guard";
import {
  VOICE_GUARDRAILS,
  detectBannedPhrases,
} from "@/lib/ai-voice-guardrails";

// Heuristic: flag comments that look like content-scraper spam.
// Triggered by: copy-paste "send me this" patterns, one-word price
// probes, botlike usernames + hype-only text. Runs BEFORE the AI
// classifier so we never pay for a call on these — and short-circuits
// the whole reply+DM path (silent drop, logged for analysis).
//
// Introduced 2026-04-20 after @europebuzz "Send me this post ❤️"
// triggered an auto-reply. That opens 24h message windows with bot
// accounts, risks Meta spam flags, and burns scarce DM bandwidth.
function isLikelyScraperSpam(
  commentText: string,
  commenterUsername: string | null,
): { scraper: boolean; reason?: string } {
  const text = (commentText ?? "").trim().toLowerCase();
  const user = (commenterUsername ?? "").toLowerCase();

  if (!text) return { scraper: false };

  // 1. Classic "send me this" / "DM me this" scraper copy-paste.
  const sendMePatterns = [
    /\bsend\s+(?:me|to\s+me)\s+(?:this|the\s+)?post\b/,
    /\bsend\s+it\s+to\s+me\b/,
    /\bdm\s+me\s+this\b/,
    /\bshare\s+(?:it|this)\s+to\s+me\b/,
    /\bcan\s+you\s+send\s+(?:me|this)\b/,
  ];
  for (const p of sendMePatterns) {
    if (p.test(text)) {
      return {
        scraper: true,
        reason: `send-me-this pattern: "${text.slice(0, 60)}"`,
      };
    }
  }

  // 2. One-word price / info probes — mass automation signature.
  // (NB: full-sentence price questions in DMs are fine — this is
  // comments only, where a one-word "Price?" is near-zero intent.)
  const oneWordProbes = ["price?", "info?", "link?", "cost?"];
  if (oneWordProbes.includes(text)) {
    return { scraper: true, reason: `one-word probe: "${text}"` };
  }

  // 3. "Link in bio?" ask when link-in-bio is obvious — scraper tell.
  if (/^link\s+in\s+bio\s*\??$/i.test(text)) {
    return { scraper: true, reason: "redundant link-in-bio ask" };
  }

  // 4. Username patterns typical of repost farms, combined with
  // hype-only text. Neither signal alone is enough — together they are.
  const botUserPatterns = [
    /_buzz$/,
    /_daily$/,
    /^travel_\w+_\d+$/,
    /^luxury_\w+_\w+$/,
    /^\w+_vibes(_\w+)?$/,
    /^\w+city_\w+$/,
    /\d{4,}$/, // trailing 4+ digit suffix — content-farm marker
  ];
  const botUserMatch = botUserPatterns.some((p) => p.test(user));
  if (botUserMatch) {
    const hypeOnly =
      text.length < 50 &&
      /^[\s❤️🤍🖤💕❤️‍🔥💯🔥✨🙌👏👌😍🤩💃😘😁😂❗❣️]+$|\b(?:beautiful|amazing|stunning|incredible|wow|gorgeous|lovely|perfect|nice)[\s.!❤️🔥✨👏]*$/i.test(
        text,
      );
    if (hypeOnly) {
      return {
        scraper: true,
        reason: `botlike username "${user}" + hype-only comment`,
      };
    }
  }

  return { scraper: false };
}

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
        // Race-safe comment auto-reply. TWO defences against dup replies:
        //
        // 1. Self-comment filter — when we POST a reply via
        //    /{comment-id}/replies, Instagram fires a new comments
        //    webhook for OUR own reply (it's technically a new comment
        //    in the thread). Without this filter we'd classify our own
        //    reply and post a reply to it, creating an infinite cascade
        //    that surfaces as "2+ replies on the original comment".
        //    ig_comment_replies.UNIQUE(comment_id) doesn't help here
        //    because each cascaded reply has its own fresh id.
        //    Fix: skip anything where from.id matches our page id OR
        //    the username matches our handle.
        //
        // 2. UNIQUE(comment_id) mutex on ig_comment_replies — we INSERT
        //    a claim row FIRST. If the DB rejects it with error 23505
        //    (unique violation) another webhook delivery is already
        //    handling this comment and we silently exit. Only the
        //    winning insert proceeds to the AI call, the Instagram
        //    reply POST, and the final UPDATE.
        const commentRaw = (change.value?.text ?? "").trim();
        const commentId = change.value?.id;
        const commenterId = change.value?.from?.id;
        const commenterUsername = change.value?.from?.username;
        const parentMediaId = change.value?.media?.id;

        if (!commentId || !commentRaw) continue;

        // Defence #1 — never reply to ourselves. Matches by numeric
        // page id (most reliable) with a handle fallback.
        const isSelfComment =
          (commenterId && String(commenterId) === String(igId)) ||
          (commenterUsername &&
            String(commenterUsername).toLowerCase() === "georgeyachts");
        if (isSelfComment) continue;

        // Step A — Atomic claim. INSERT with status='claimed'. If the
        // comment_id already exists in the table (from a concurrent
        // delivery OR a prior successful reply) the INSERT fails with
        // PostgREST code 23505 and we exit. No race possible.
        const { error: claimError } = await sb
          .from("ig_comment_replies")
          .insert({
            comment_id: commentId,
            post_id: parentMediaId ?? null,
            commenter_id: commenterId ?? null,
            commenter_username: commenterUsername ?? null,
            comment_text: commentRaw.slice(0, 1000),
            status: "claimed",
          });

        if (claimError) {
          // Unique violation → duplicate delivery. Silently stop.
          // Any other error is logged but we also stop so we never
          // accidentally reply without a claim row to audit.
          const isDupe =
            claimError.code === "23505" ||
            /duplicate key|unique/i.test(claimError.message ?? "");
          if (!isDupe) {
            console.error("[IG Webhook] Claim insert failed:", claimError);
          }
          continue;
        }

        try {
          // NOTE: The per-commenter 24h cooldown was removed. It made
          // the bot feel broken for low-volume accounts — if a fan
          // commented on two posts the same day, only the first got a
          // reply. The UNIQUE(comment_id) mutex + self-comment filter
          // are enough: "1 comment = 1 reply, and we never talk to
          // ourselves". Every genuine comment from every user now
          // gets its own contextual reply, classified independently.

          // ── CONTENT_SCRAPER_SPAM gate (Phase F, 2026-04-20) ──
          // Run a heuristic scraper-spam check BEFORE we spend an AI
          // call or open a messaging window. Silent drop — no reply,
          // no DM, no Telegram. Just flip the claim row to skipped
          // with a distinct status so retro analysis can count these.
          const scraperCheck = isLikelyScraperSpam(commentRaw, commenterUsername);
          if (scraperCheck.scraper) {
            await sb
              .from("ig_comment_replies")
              .update({
                status: "scraper_spam",
                reply_text: "",
                error: scraperCheck.reason ?? "scraper spam heuristic",
              })
              .eq("comment_id", commentId);
            continue;
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

          const classifyPrompt = `${VOICE_GUARDRAILS}

Classify this Instagram comment and, if it's genuine engagement, write a reply in the George Yachts brand voice.

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
- Warm but professional, George Yachts brand voice (NOT personal "I")
- NEVER just "Thanks!" / "Appreciate it!" — add ONE small, specific Greek-waters insight relevant to the post. Concrete detail, not superlatives.
- NEVER include links or business names
- NEVER mention pricing, bookings, or selling
- Obey every BRAND VOICE RULE above — especially banned fillers ("unparalleled", "unforgettable", "exceptional", "stunning", etc.) and the emoji whitelist.

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
            // Flip the claim row so we don't reclassify this comment
            // next delivery and we have an audit trail for spam/emoji
            // skips.
            await sb
              .from("ig_comment_replies")
              .update({
                status: "skipped",
                reply_text: "",
                error: "AI classified as spam/emoji/non-genuine",
              })
              .eq("comment_id", commentId);
            continue;
          }

          let replyText = String(aiVerdict.reply).trim().slice(0, 500);

          // Phase F — banned-phrase check on the reply. If the model
          // slipped in filler ("unparalleled", "unforgettable", etc.),
          // try ONE regeneration with the offending phrases called out.
          // If still bad, log to Telegram and publish anyway (fail-open).
          const repliesBanned = detectBannedPhrases(replyText);
          if (repliesBanned.length > 0) {
            try {
              const retryPrompt = `${classifyPrompt}\n\nAVOID these filler words that slipped in: ${repliesBanned.join(", ")}. Replace each with a concrete specific.`;
              const retryRaw = await aiChat(
                "You classify Instagram comments and return only JSON. No markdown.",
                retryPrompt,
              );
              const rm = retryRaw.match(/\{[\s\S]*\}/);
              if (rm) {
                const retryVerdict = JSON.parse(rm[0]);
                if (retryVerdict?.action === "reply" && retryVerdict?.reply) {
                  replyText = String(retryVerdict.reply).trim().slice(0, 500);
                }
              }
            } catch {
              // retry failed — keep first attempt
            }
            // Final check — alert if still dirty.
            const stillBanned = detectBannedPhrases(replyText);
            if (stillBanned.length > 0) {
              await sendTelegram(
                `⚠ Comment reply voice audit — banned filler slipped through to @${commenterUsername ?? "unknown"}: ${stillBanned.join(", ")}. Tighten the classifier prompt.`,
              );
            }
          }

          // Phase A — rate-limit breaker. If we're near Meta's hourly
          // reply cap, skip this one. The UNIQUE(comment_id) mutex already
          // keeps us idempotent so skipping is safe — we just won't reply.
          if (!(await checkRateLimitHealth("comment_reply"))) {
            continue;
          }

          // Post reply to Instagram. Capture the reply id from the
          // response so we have a proof-of-post to store.
          let replyApiId: string | null = null;
          try {
            const postRes = await fetch(
              `https://graph.instagram.com/v21.0/${commentId}/replies`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: replyText, access_token: igToken }),
              }
            );
            const postJson = await postRes.json();
            replyApiId = postJson?.id ?? null;
            if (!postRes.ok && !replyApiId) {
              throw new Error(
                postJson?.error?.message ?? `HTTP ${postRes.status}`
              );
            }
            // Log for rate-limit accounting (only on real success).
            if (replyApiId) {
              await logRateLimitAction("comment_reply", {
                comment_id: commentId,
                reply_id: replyApiId,
              });
            }
          } catch (err) {
            // Reply post failed — flip the claim row to `failed` so
            // future deliveries don't re-attempt AND so we have a
            // record for manual review.
            await sb
              .from("ig_comment_replies")
              .update({
                status: "failed",
                error: err instanceof Error ? err.message : "post failed",
              })
              .eq("comment_id", commentId);
            continue;
          }

          // Success — finalize the claim row with reply id + text
          // + timestamp.
          await sb
            .from("ig_comment_replies")
            .update({
              status: "posted",
              reply_id: replyApiId,
              reply_text: replyText,
              replied_at: new Date().toISOString(),
            })
            .eq("comment_id", commentId);

          await sendTelegram(
            `💬 <b>Auto-replied to comment</b> from @${escapeHtml(commenterUsername ?? commenterId ?? "unknown")}\n<i>"${escapeHtml(commentRaw.slice(0, 120))}"</i>\n→ ${escapeHtml(replyText.slice(0, 150))}`
          ).catch(() => {});
        } catch (err) {
          console.error("[IG Webhook] Comment auto-reply error:", err);
          // Best-effort: if we crashed somewhere mid-flight after the
          // claim insert, flip the row to `failed` so retries see it.
          await sb
            .from("ig_comment_replies")
            .update({
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
            })
            .eq("comment_id", commentId)
            .catch(() => {});
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

            // 1. Thank-you DM back to the sender — gated on dm_send cap.
            if (await checkRateLimitHealth("dm_send")) {
              await fetch(`https://graph.instagram.com/v21.0/me/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  recipient: { id: senderId },
                  message: { text: STORY_MENTION_REPLY },
                  access_token: igToken,
                }),
              });
              await logRateLimitAction("dm_send", {
                kind: "story_mention_thanks",
                sender_id: senderId,
              });
            }

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

          // Phase A — rate-limit breaker. If near dm_send cap, skip
          // the auto-reply. The manual Telegram alert below still fires
          // so George sees the DM and can respond personally.
          const dmSendAllowed = await checkRateLimitHealth("dm_send");
          if (dmSendAllowed) {
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
            await logRateLimitAction("dm_send", {
              kind: "auto_reply",
              intent,
              sender_id: senderId,
            });
          }

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
