// @ts-nocheck
import { NextResponse } from "next/server";
import { observeCron } from "@/lib/cron-observer";

// Daily SERP snapshot — calls the tracker's refresh so the Brand Radar
// history builds itself even when nobody presses REFRESH. Weekday
// mornings only; ~$0.08 per run against the DataForSEO balance.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function handler(): Promise<Response> {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://command.georgeyachts.com";
  const res = await fetch(`${base}/api/brand-radar/serp`, { method: "POST", cache: "no-store" });
  const data = await res.json();
  if (data?.error) return NextResponse.json({ error: data.error });
  return NextResponse.json({
    ok: true,
    found_in_top30: data.found_in_top30,
    avg_position_when_found: data.avg_position_when_found,
    cost_usd: data.cost_usd,
  });
}

export async function GET() {
  return observeCron("serp-snapshot", handler);
}
