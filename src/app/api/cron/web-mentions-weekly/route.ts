// @ts-nocheck
import { NextResponse } from "next/server";
import { observeCron } from "@/lib/cron-observer";

// Weekly web-mentions refresh — keeps the Brand Radar intel moving without
// anyone pressing a button. See /api/brand-radar/web-mentions for the logic.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function handler(): Promise<Response> {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://command.georgeyachts.com";
  const res = await fetch(`${base}/api/brand-radar/web-mentions`, { method: "POST", cache: "no-store" });
  const data = await res.json();
  if (data?.error) return NextResponse.json({ error: data.error });
  return NextResponse.json({ ok: true, cost_usd: data.cost_usd ?? null });
}

export async function GET() {
  return observeCron("web-mentions-weekly", handler);
}
