// /api/cockpit/briefing — single read endpoint that powers the entire
// new dashboard home. Returns the CockpitBriefing object: today's 3
// actions, pipeline pulse, proactive opportunities, brainstorm prompt.
//
// Cached per-day in settings.cockpit_briefing_<YYYY-MM-DD> so multiple
// page-loads + the morning Telegram cron share the same snapshot. Pass
// ?fresh=1 to force regeneration.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { buildBriefing } from "@/lib/cockpit-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.get("fresh") === "1";
  const sb = createServiceClient();

  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `cockpit_briefing_${today}`;

  // Try cache (unless fresh=1)
  if (!fresh) {
    const { data: cached } = await sb
      .from("settings")
      .select("value")
      .eq("key", cacheKey)
      .maybeSingle();
    if (cached?.value) {
      try {
        const parsed = JSON.parse(cached.value as string);
        return NextResponse.json({ ...parsed, _cached: true });
      } catch {
        /* corrupt cache, fall through to rebuild */
      }
    }
  }

  // Build fresh
  try {
    const briefing = await buildBriefing(sb);
    // Persist for the day
    await sb
      .from("settings")
      .upsert({ key: cacheKey, value: JSON.stringify(briefing) });
    return NextResponse.json({ ...briefing, _cached: false });
  } catch (e: any) {
    console.error("[cockpit/briefing] build failed:", e);
    return NextResponse.json(
      { error: e?.message ?? "briefing build failed" },
      { status: 500 },
    );
  }
}
