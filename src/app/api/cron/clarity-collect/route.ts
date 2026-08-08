// The nightly Clarity pull.
//
// 2026-08-08. See src/lib/clarity.ts for the whole story. The short version:
// the Data Export API only reaches back three days and allows ten calls a day,
// so a Monday-only job would report three days and call it a week. This takes
// three calls a night, one per breakdown, and stores the day.
//
// It is deliberately silent. A collector that pings every morning to say it
// collected something gets muted, and then it is not a collector any more, it
// is noise. It speaks only when a whole day has been lost.

import { NextRequest, NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import {
  DIMENSIONS,
  fetchDimension,
  writeDay,
  type ClarityMetric,
  type DaySnapshot,
  type Dimension,
} from "@/lib/clarity";

export const runtime = "nodejs";
export const maxDuration = 60;

async function _observedImpl(request: NextRequest): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const isVercelCron = request.headers.get("user-agent")?.includes("vercel-cron");
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.CLARITY_API_TOKEN;
  if (!token) {
    // Not an error worth waking anyone for: it simply means Clarity has not
    // been wired up yet, or the token was rotated and not replaced.
    return NextResponse.json({ ok: false, reason: "no-clarity-token" });
  }

  // Clarity returns UTC, and numOfDays=1 means "the last 24 hours". Stamping
  // the snapshot with yesterday's UTC date keeps the label honest: a job that
  // runs at 05:40 Athens is reporting on the day that has just ended.
  const stamp = new Date();
  stamp.setUTCDate(stamp.getUTCDate() - 1);
  const date = stamp.toISOString().slice(0, 10);

  const byDimension: Partial<Record<Dimension, ClarityMetric[]>> = {};
  const failed: string[] = [];

  for (const dim of DIMENSIONS) {
    const rows = await fetchDimension(token, dim, 1);
    if (rows) byDimension[dim] = rows;
    else failed.push(dim);
  }

  if (failed.length === DIMENSIONS.length) {
    await sendTelegram(
      `⚠️ Clarity collected nothing for ${date}. All three pulls failed, so Monday's report will have a hole in it. Usually an expired API token: Clarity, Settings, Data export.`,
    );
    return NextResponse.json({ ok: false, date, failed });
  }

  const day: DaySnapshot = { date, byDimension, failed };
  await writeDay(day);

  return NextResponse.json({
    ok: true,
    date,
    collected: Object.keys(byDimension),
    failed,
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return observeCron("clarity-collect", () => _observedImpl(request));
}
