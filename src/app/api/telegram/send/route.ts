import { NextRequest, NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";
import { requireUser } from "@/lib/require-user";

export async function POST(request: NextRequest) {
  const denied = await requireUser(request);
  if (denied) return denied;
  try {
    const { message } = await request.json();
    if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
    await sendTelegram(message);
    return NextResponse.json({ ok: true, message: "Sent to Telegram" });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// Also support GET for quick testing
export async function GET(request: Request) {
  const denied = await requireUser(request);
  if (denied) return denied;
  try {
    await sendTelegram("GY Command Center — Telegram connection test successful!");
    return NextResponse.json({ ok: true, message: "Test notification sent to Telegram" });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
