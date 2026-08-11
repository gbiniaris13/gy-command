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
import { getSetting, setSetting } from "@/lib/google-api";
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

const ZERO_STREAK_KEY = "clarity_zero_streak";
const ZERO_DAYS_BEFORE_ALERT = 3;

/** Total sessions in the day, read from the Device breakdown only so the
 *  three dimensions do not triple-count the same traffic. */
function countSessions(
  byDimension: Partial<Record<Dimension, ClarityMetric[]>>,
): number {
  const traffic = byDimension.Device?.find(
    (m) => m.metricName.toLowerCase() === "traffic",
  );
  if (!traffic) return 0;
  return traffic.information.reduce((sum, row) => {
    const n = Number(row.totalSessionCount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

async function getStreak(): Promise<number> {
  const raw = await getSetting(ZERO_STREAK_KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function setStreak(n: number): Promise<void> {
  await setSetting(ZERO_STREAK_KEY, String(n));
}

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

  // The silent-zero watchdog.
  //
  // 2026-08-11. Clarity spent a day looking broken and being right to: the
  // tag was installed correctly, but the consentv2 signal was missing and the
  // EEA has required it since 31 October 2025, so nothing was recorded. The
  // API answered 200 the whole time. A pull that succeeds and returns nothing
  // is indistinguishable from a pull that succeeds and returns a quiet day,
  // which is exactly how an install stays broken for a week without anyone
  // noticing.
  //
  // So: count sessions. One quiet day says nothing. Three consecutive days of
  // absolute zero on a site with daily traffic says the pipe is cut, and that
  // is worth one message. It resets itself the moment a session appears, and
  // it never repeats while the streak continues.
  const sessions = countSessions(byDimension);
  const streakRaw = await getStreak();
  const streak = sessions > 0 ? 0 : streakRaw + 1;
  await setStreak(streak);

  if (sessions === 0 && streak === ZERO_DAYS_BEFORE_ALERT) {
    await sendTelegram(
      `⚠️ Clarity has recorded <b>zero sessions for ${streak} days running</b>.\n\n` +
        `The API is answering, so this is not the token. Most likely the tag stopped ` +
        `loading, or the consent signal stopped firing.\n\n` +
        `Check: open georgeyachts.com, accept analytics, and confirm the page requests ` +
        `clarity.ms/tag and that the inline script still carries the consentv2 call.`,
    );
  }

  return NextResponse.json({
    ok: true,
    date,
    collected: Object.keys(byDimension),
    failed,
    sessions,
    zeroStreak: streak,
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return observeCron("clarity-collect", () => _observedImpl(request));
}
