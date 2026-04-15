// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { LINKEDIN_DAILY_LIMITS } from "@/lib/linkedin-safety";

// GET /api/linkedin/safety-check
//
// Returns today's LinkedIn action counts vs the safety caps, plus a
// boolean per action type that says "safe to take one more". Domingo
// hits this BEFORE every browser action and refuses if the cap is
// already reached. George's LinkedIn is the most valuable asset; we
// never bypass these limits.

export async function GET() {
  const sb = createServiceClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await sb
    .from("linkedin_actions")
    .select("action_type, status")
    .gte("created_at", todayStart.toISOString());

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
        // Return SAFE values on error so Domingo doesn't accidentally
        // act on a corrupted count.
        safe: false,
      },
      { status: 500 }
    );
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    if (row.status === "rejected" || row.status === "failed") continue;
    counts[row.action_type] = (counts[row.action_type] ?? 0) + 1;
  }

  const status: Record<
    string,
    { used: number; limit: number; remaining: number; safe: boolean }
  > = {};

  let allSafe = true;
  for (const [type, limit] of Object.entries(LINKEDIN_DAILY_LIMITS)) {
    const used = counts[type] ?? 0;
    const remaining = Math.max(0, limit - used);
    const safe = remaining > 0;
    if (!safe) allSafe = false;
    status[type] = { used, limit, remaining, safe };
  }

  return NextResponse.json({
    date: todayStart.toISOString().slice(0, 10),
    allSafe,
    status,
  });
}
