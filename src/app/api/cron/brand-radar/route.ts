// @ts-nocheck
import { NextResponse } from "next/server";

// RETIRED 2026-07-09 (George's directive: Brand Radar is manual-only).
// The Sunday cron entry was removed from vercel.json the same day.
//
// Why it died in the first place: this route looped all 80 Gemini queries
// with a 1s delay inside ONE serverless invocation — Vercel's 60s ceiling
// killed every scan at query ~23-25 and the weekly rollup never happened.
// The replacement is batch-based and driven by the dashboard button:
//   POST /api/brand-radar/scan  (8 queries per call, resumes if cut off)
export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      status: "retired",
      replacement: "POST /api/brand-radar/scan",
      note: "Brand Radar scans are manual-only, run from the dashboard.",
    },
    { status: 410 },
  );
}
