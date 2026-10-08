// THE MONDAY FIVE, the door for the two numbers a server cannot fetch.
//
//   GET  /api/admin/monday-five?secret=<CRON_SECRET>   → the five, as JSON
//   POST /api/admin/monday-five  (Bearer CRON_SECRET)
//        { ai_panel?: {date, prompts, chatgpt, google, copilot},
//          bing_ai?:  {date, window, total, buying, share},
//          send?: true }                                → stores, optionally emails the five
//
// The Mac's Monday task reads ChatGPT, Google AI Mode and Bing Webmaster
// Tools in a browser, then posts here. Nothing else writes these keys.

import { NextRequest, NextResponse } from "next/server";
import { buildMondayFive, saveMondayManual, sendMondayFive, type AiPanel, type BingAi } from "@/lib/monday-five";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const q = req.nextUrl.searchParams.get("secret") ?? "";
  return bearer === secret || q === secret;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const five = await buildMondayFive();
  return NextResponse.json(five);
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { ai_panel?: AiPanel; bing_ai?: BingAi; send?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const num = (x: unknown) => (x == null || x === "" ? null : Number(x));
  const ai_panel = body.ai_panel
    ? { date: String(body.ai_panel.date).slice(0, 10), prompts: Number(body.ai_panel.prompts) || 10, chatgpt: num(body.ai_panel.chatgpt), google: num(body.ai_panel.google), copilot: num(body.ai_panel.copilot), notes: body.ai_panel.notes ? String(body.ai_panel.notes).slice(0, 300) : undefined }
    : undefined;
  const bing_ai = body.bing_ai
    ? { date: String(body.bing_ai.date).slice(0, 10), window: String(body.bing_ai.window).slice(0, 60), total: Number(body.bing_ai.total) || 0, buying: Number(body.bing_ai.buying) || 0, share: Number(body.bing_ai.share) || 0, notes: body.bing_ai.notes ? String(body.bing_ai.notes).slice(0, 300) : undefined }
    : undefined;
  await saveMondayManual({ ai_panel, bing_ai });
  if (body.send) {
    const r = await sendMondayFive();
    return NextResponse.json({ ok: true, stored: { ai_panel: !!ai_panel, bing_ai: !!bing_ai }, sent: r.sent, five: r.five });
  }
  const five = await buildMondayFive();
  return NextResponse.json({ ok: true, stored: { ai_panel: !!ai_panel, bing_ai: !!bing_ai }, five });
}
