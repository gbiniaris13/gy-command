import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// GET — Webhook verification
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.IG_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// POST — Receive webhook events
export async function POST(request: NextRequest) {
  const body = await request.json();
  const token = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!token || !igId) return NextResponse.json({ status: "no config" });

  const sb = createServiceClient();

  for (const entry of body.entry ?? []) {
    // Handle new followers — send welcome DM
    for (const change of entry.changes ?? []) {
      if (change.field === "followers" || change.value?.event === "follow") {
        const followerId = change.value?.from?.id;
        if (followerId) {
          await sendWelcomeDM(followerId, token, igId, sb);
        }
      }

      // Handle comments — auto-reply to price/booking questions
      if (change.field === "comments") {
        const commentText = (change.value?.text ?? "").toLowerCase();
        const commentId = change.value?.id;
        if (commentId) {
          const priceWords = ["price", "cost", "how much", "rate", "πόσο", "τιμή", "κόστος"];
          const bookWords = ["book", "reserve", "available", "availability", "κράτηση"];
          const isPriceQ = priceWords.some((w) => commentText.includes(w));
          const isBookQ = bookWords.some((w) => commentText.includes(w));

          if (isPriceQ || isBookQ) {
            const reply = isPriceQ
              ? "Thank you for your interest! Charter rates vary by yacht and season. Send us a DM or visit georgeyachts.com for personalized options"
              : "We'd love to help you plan your charter! Send us a DM with your dates and group size, or book a free consultation at georgeyachts.com";

            await fetch(`https://graph.instagram.com/v21.0/${commentId}/replies`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: reply, access_token: token }),
            }).catch(() => {});
          }
        }
      }
    }

    // Handle messaging events
    for (const msg of entry.messaging ?? []) {
      if (msg.message && !msg.message.is_echo) {
        // Could add auto-reply logic here
      }
    }
  }

  return NextResponse.json({ status: "ok" });
}

async function sendWelcomeDM(
  recipientId: string,
  token: string,
  igId: string,
  sb: ReturnType<typeof createServiceClient>
) {
  const message = `Thank you for following George Yachts! 🇬🇷

We curate luxury crewed yacht charters across the Greek Islands — Mykonos, Santorini, the Ionian, and beyond.

Planning a trip to Greece? We'd love to help you find the perfect yacht. Just send us a message anytime!

Fair winds,
George`;

  try {
    await fetch(`https://graph.instagram.com/v21.0/${igId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
        access_token: token,
      }),
    });

    await sb.from("ig_welcome_dms").insert({
      recipient_id: recipientId,
      sent_at: new Date().toISOString(),
    }).catch(() => {});
  } catch {
    // silent
  }
}
