// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";
import { createNotification } from "@/lib/notifications";
import { createServiceClient } from "@/lib/supabase-server";

// Webhook receiver for ManyChat IG DM replies.
//
// Why this exists: Instagram Graph API doesn't expose a follows webhook
// and forbids cold DMs to users who haven't opened a conversation with
// the page. ManyChat works around this via the official Meta Business
// integration — when a user follows @georgeyachts ManyChat fires the
// "New Follower" automation and sends George's welcome line. When the
// user REPLIES to that DM, ManyChat can fire an "External Request"
// step that POSTs the reply to this endpoint.
//
// We forward every reply to Telegram immediately and create an in-app
// notification on the bell so George sees both surfaces light up.
//
// Setup steps (one-time, manual on manychat.com):
//   1. Sign up at https://manychat.com/ (free plan covers up to 1,000
//      contacts, plenty for the current following).
//   2. Connect the Instagram Business account via Meta Business.
//   3. Build the New Follower automation:
//        Trigger: New Follower
//        Action: Send Message → "Hey! Thanks for the follow 🙏 If
//        you're ever thinking about Greece by sea, I'm here."
//   4. Build the Reply automation:
//        Trigger: User Reply (any message after the welcome)
//        Action: External Request → POST to
//          https://gy-command-george-biniaris-projects.vercel.app/api/webhooks/manychat
//        Headers:
//          Content-Type: application/json
//          X-Manychat-Secret: <same value you set in MANYCHAT_SECRET env var>
//        Body (JSON):
//          {
//            "type": "reply",
//            "user_id": "{{user_id}}",
//            "username": "{{username}}",
//            "first_name": "{{first_name}}",
//            "last_name": "{{last_name}}",
//            "message_text": "{{last_input_text}}",
//            "received_at": "{{current_datetime_iso}}"
//          }
//   5. Add MANYCHAT_SECRET to gy-command's Vercel env vars so the
//      shared-secret auth check below passes.
//
// Until ManyChat is wired up, this endpoint just sits idle — it returns
// 401 to anyone hitting it without the secret, so it's safe to ship.

interface ManychatReply {
  type?: string;
  user_id?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  message_text?: string;
  received_at?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: NextRequest) {
  const expected = process.env.MANYCHAT_SECRET;
  if (!expected) {
    return NextResponse.json(
      {
        error: "MANYCHAT_SECRET not configured",
        setup:
          "Pick a random string, add MANYCHAT_SECRET to Vercel env vars, paste the same value into ManyChat's External Request → Headers → X-Manychat-Secret.",
      },
      { status: 500 }
    );
  }

  const headerSecret = req.headers.get("x-manychat-secret");
  if (headerSecret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ManychatReply;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const handle =
    body.username && body.username.length > 0
      ? `@${body.username}`
      : [body.first_name, body.last_name].filter(Boolean).join(" ") ||
        body.user_id ||
        "unknown user";

  const text = (body.message_text ?? "").trim();
  const preview = text.length > 200 ? text.slice(0, 200) + "…" : text;

  // Fire and forget — Telegram first so George sees it instantly,
  // then the in-app bell.
  await sendTelegram(
    `🟢 <b>IG DM reply via ManyChat from ${escapeHtml(handle)}</b>\n${escapeHtml(preview || "(empty message)")}`
  ).catch(() => {});

  try {
    const sb = createServiceClient();
    await createNotification(sb, {
      type: "ig_dm",
      title: `📩 ManyChat reply from ${handle}`,
      description: preview || "(empty message)",
      link: "/dashboard/instagram",
    });
  } catch {
    // Notification failure shouldn't break the webhook ack
  }

  return NextResponse.json({ ok: true });
}

// Health check — lets George verify the URL is reachable from ManyChat
// before he tries the real automation.
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/webhooks/manychat",
    expects: "POST with X-Manychat-Secret header",
  });
}
