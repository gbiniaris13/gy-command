// @ts-nocheck
// Telegram webhook endpoint — owns ALL inbound updates for the gy-command
// bot. Two responsibilities:
//
//   1. callback_query  → IG caption-approval inline-button taps. Flips
//      ig_posts.status based on the button. Original behaviour, untouched.
//
//   2. message.text    → bot commands typed by the operator. Currently
//      handled: /status (Command Center snapshot pushed back to chat).
//      Anything else is silently ignored to keep the bot quiet.
//
// Configure once via BotFather:
//   setWebhook url=https://gy-command.vercel.app/api/webhooks/telegram-approval
//
// Newsletter approvals deliberately use URL inline buttons — they do
// NOT flow through this webhook. Don't add newsletter logic here.

import { NextResponse } from "next/server";
import { handleApprovalCallback } from "@/lib/caption-approval-gate";
import { sendTelegram } from "@/lib/telegram";
import { createServiceClient } from "@/lib/supabase-server";
import {
  buildCommandCenterSnapshot,
  formatSnapshotForTelegram,
} from "@/lib/command-center-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleStatusCommand(): Promise<{ ok: boolean; mode: string }> {
  try {
    const sb = createServiceClient();
    const snapshot = await buildCommandCenterSnapshot(sb);
    const message = formatSnapshotForTelegram(snapshot);
    const sent = await sendTelegram(message, { disablePreview: true });
    return { ok: sent, mode: "status" };
  } catch (e: any) {
    console.error("[telegram /status] failed:", e);
    await sendTelegram(
      `🎛 <b>GY COMMAND CENTER</b>\n\n⛔ Snapshot build failed.\n<i>${String(e?.message ?? e).slice(0, 200)}</i>`,
      { disablePreview: true },
    );
    return { ok: false, mode: "status_error" };
  }
}

export async function POST(request: Request) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: "non-json" });
  }

  const expectedChat =
    process.env.TELEGRAM_CHAT_ID && String(process.env.TELEGRAM_CHAT_ID);

  // ── Branch 1: callback_query (IG approval taps) ─────────────────────
  const cb = body.callback_query;
  if (cb) {
    const callbackData = String(cb.data ?? "");
    const callbackId = String(cb.id ?? "");
    const fromChat = cb.message?.chat?.id ? String(cb.message.chat.id) : null;
    if (expectedChat && fromChat && expectedChat !== fromChat) {
      return NextResponse.json({ ok: false, error: "chat_mismatch" });
    }
    const result = await handleApprovalCallback(callbackData, callbackId);
    return NextResponse.json(result);
  }

  // ── Branch 2: text command (e.g. /status) ───────────────────────────
  const msg = body.message;
  const text = msg?.text ? String(msg.text).trim() : "";
  if (text) {
    const fromChat = msg.chat?.id ? String(msg.chat.id) : null;
    if (expectedChat && fromChat && expectedChat !== fromChat) {
      return NextResponse.json({ ok: false, error: "chat_mismatch" });
    }
    // Strip optional bot suffix: "/status@gy_bot" → "/status"
    const cmd = text.split(/[\s@]/)[0].toLowerCase();
    if (cmd === "/status" || cmd === "/cockpit") {
      const result = await handleStatusCommand();
      return NextResponse.json(result);
    }
    // Unknown command — quiet ignore.
    return NextResponse.json({ ok: true, ignored: "unknown_command", cmd });
  }

  // ── Anything else (edits, reactions, etc.) — quiet ignore ──────────
  return NextResponse.json({ ok: true, ignored: "no-callback-no-text" });
}
