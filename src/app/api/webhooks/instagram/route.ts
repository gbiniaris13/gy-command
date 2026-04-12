// @ts-nocheck
import { NextRequest } from "next/server";

const VERIFY_TOKEN = "gy_command_webhook_2026";

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
    }
  }

  return Response.json({ status: "ok" });
}
