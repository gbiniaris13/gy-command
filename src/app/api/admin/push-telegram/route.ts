// /api/admin/push-telegram — minimal pass-through to push a HTML
// message to George's Telegram. Used by Claude Code Chrome-MCP-based
// IG scans to deliver drafts when curl-direct-to-Telegram fails (the
// hardcoded fallback token in lib/telegram.ts has rotated; production
// uses env-loaded TELEGRAM_BOT_TOKEN).
//
// POST { text: "..." } → forwards to sendTelegram → returns {ok}.
// Trivially auth'd via shared secret query param so curl from outside
// can't spam George's chat. Set ADMIN_PUSH_KEY env var on Vercel.

import { NextRequest, NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

const SECRET = process.env.ADMIN_PUSH_KEY || "gy-claude-2026";

export async function POST(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (key !== SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { text?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const text = (body.text || "").slice(0, 4096);
  if (!text.trim()) {
    return NextResponse.json({ error: "empty text" }, { status: 400 });
  }
  const ok = await sendTelegram(text, { disablePreview: true });
  return NextResponse.json({ ok });
}
