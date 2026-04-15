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

      // Comment auto-reply
      if (change.field === "comments") {
        const commentText = (change.value?.text ?? "").toLowerCase();
        const commentId = change.value?.id;
        if (commentId) {
          const priceWords = ["price", "cost", "how much", "rate"];
          const bookWords = ["book", "reserve", "available"];
          const isPriceQ = priceWords.some((w) => commentText.includes(w));
          const isBookQ = bookWords.some((w) => commentText.includes(w));

          if (isPriceQ || isBookQ) {
            const reply = isPriceQ
              ? "Thank you for your interest! Charter rates vary by yacht and season. Send us a DM or visit georgeyachts.com for personalized options"
              : "We'd love to help! Send us a DM with your dates and group size, or visit georgeyachts.com";

            await fetch(`https://graph.instagram.com/v21.0/${commentId}/replies`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: reply, access_token: igToken }),
            }).catch(() => {});
          }
        }
      }

      // DM auto-reply
      if (change.field === "messages") {
        const messaging = change.value;
        const senderId = messaging?.sender?.id;
        const messageText = messaging?.message?.text;

        // Skip if it's our own message (echo) or no text
        if (!senderId || !messageText || senderId === igId) continue;

        // Resolve the sender's @username once so every downstream
        // notification uses the same friendly handle.
        const handle = await resolveIgUsername(senderId, igToken);

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
