// @ts-nocheck
import { NextRequest } from "next/server";
import { aiChat } from "@/lib/ai";

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
      // New follower → welcome DM
      if (change.field === "followers" || change.value?.event === "follow") {
        const followerId = change.value?.from?.id;
        if (followerId) {
          const message = `Thank you for following George Yachts! We curate luxury crewed yacht charters across the Greek Islands. Planning a trip to Greece? Just send us a message anytime! Fair winds, George`;
          await fetch(`https://graph.instagram.com/v21.0/${igId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id: followerId },
              message: { text: message },
              access_token: igToken,
            }),
          }).catch(() => {});

          await sb.from("ig_welcome_dms").insert({
            recipient_id: followerId,
            sent_at: new Date().toISOString(),
          }).catch(() => {});
        }
      }

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

        try {
          // Rate limit: max 1 auto-reply per user per 24 hours
          const { data: recent } = await sb
            .from("ig_dm_replies")
            .select("id")
            .eq("sender_id", senderId)
            .gte("sent_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .limit(1);

          if (recent && recent.length > 0) continue; // Already replied in last 24h

          // Classify intent via AI
          let intent = "general";
          try {
            const classification = await aiChat(DM_CLASSIFY_PROMPT, messageText);
            const cleaned = classification.trim().toLowerCase();
            if (cleaned in DM_TEMPLATES) intent = cleaned;
          } catch {
            intent = "general"; // Fallback if AI fails
          }

          const reply = DM_TEMPLATES[intent] || DM_TEMPLATES.general;

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
        } catch (err) {
          console.error("[IG Webhook] DM reply error:", err);
        }
      }
    }
  }

  return Response.json({ status: "ok" });
}
