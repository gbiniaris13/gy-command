// One-shot: shift every upcoming scheduled ig_posts row from any UTC
// hour to the canonical PUBLISH_HOUR_UTC (15 → 18:00 Athens summer).
//
// Run after a hour-policy change so the queue stays consistent. Updates
// BOTH schedule_time and scheduled_for so the trigger that mirrors them
// is happy. Idempotent — rows already at the target hour are no-ops.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const sb = createServiceClient();
  const targetHour = parseInt(
    req.nextUrl.searchParams.get("hour") ?? "15",
    10,
  );
  if (targetHour < 0 || targetHour > 23) {
    return NextResponse.json({ error: "hour must be 0..23" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data: rows } = await sb
    .from("ig_posts")
    .select("id, schedule_time, scheduled_for, status")
    .gte("schedule_time", now)
    .in("status", ["scheduled", "pending_approval"])
    .limit(500);

  type Row = {
    id: string;
    schedule_time: string;
    scheduled_for: string | null;
    status: string;
  };
  let shifted = 0;
  const results: { id: string; from: string; to: string }[] = [];

  for (const r of (rows ?? []) as Row[]) {
    const dt = new Date(r.schedule_time);
    if (dt.getUTCHours() === targetHour) continue; // already correct
    const newDt = new Date(dt);
    newDt.setUTCHours(targetHour, 0, 0, 0);
    const newIso = newDt.toISOString();
    const { error } = await sb
      .from("ig_posts")
      .update({ schedule_time: newIso, scheduled_for: newIso })
      .eq("id", r.id);
    if (!error) {
      shifted += 1;
      results.push({ id: r.id, from: r.schedule_time, to: newIso });
    }
  }

  return NextResponse.json({
    ok: true,
    target_hour_utc: targetHour,
    examined: (rows ?? []).length,
    shifted,
    sample: results.slice(0, 10),
  });
}
