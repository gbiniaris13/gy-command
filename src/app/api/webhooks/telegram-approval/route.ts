// @ts-nocheck
// Telegram webhook endpoint for inline-button approval callbacks.
//
// Configure once via BotFather:
//   setWebhook url=https://gy-command.vercel.app/api/webhooks/telegram-approval
//
// Any callback_query routed here flips ig_posts.status based on the
// button the user tapped. Non-callback updates (text messages, etc.)
// are ignored by this endpoint — they have their own handler.

import { NextResponse } from "next/server";
import { handleApprovalCallback } from "@/lib/caption-approval-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: "non-json" });
  }
  const cb = body.callback_query;
  if (!cb) return NextResponse.json({ ok: true, ignored: "no-callback" });

  const callbackData = String(cb.data ?? "");
  const callbackId = String(cb.id ?? "");
  // Optional security: check from.id matches expected chat/user.
  const expectedChat =
    process.env.TELEGRAM_CHAT_ID && String(process.env.TELEGRAM_CHAT_ID);
  const fromChat = cb.message?.chat?.id
    ? String(cb.message.chat.id)
    : null;
  if (expectedChat && fromChat && expectedChat !== fromChat) {
    return NextResponse.json({ ok: false, error: "chat_mismatch" });
  }

  const result = await handleApprovalCallback(callbackData, callbackId);
  return NextResponse.json(result);
}
