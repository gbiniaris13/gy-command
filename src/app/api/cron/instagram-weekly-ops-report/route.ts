// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";

// Cron: Thursday 07:00 UTC (10:00 Athens). 2-week observability
// sprint — 2026-04-20 → 2026-05-04 (auto-sunsets after that).
//
// Reads cron_start_* and cron_end_* rows from the settings KV table
// (written by the observeCron() wrapper around every IG cron handler)
// and builds a Telegram summary for George:
//
//   (a) successful / failed / timed-out / skipped counts per cron
//   (b) uptime % per cron, comparing completed-runs vs the expected
//       weekly firing count derived from vercel.json
//   (c) regressions: cron types with error rate > 20% this week
//       whose failure pattern looks like a new break (not the
//       already-known low-success skipped-exit modes).
//
// "Timed out" = a start row exists without a matching end row. This
// catches Vercel 504s (function killed mid-run) and true crashes
// that slip past the try/catch in the observer.
//
// Sunsets on 2026-05-04 — after that date, exits silently. George can
// re-activate with a different end date if he wants to keep monitoring.

const SUNSET_AT = new Date("2026-05-04T23:59:59Z").getTime();
const WINDOW_MS = 7 * 86400000;

// Expected weekly firing counts per cron — derived from vercel.json.
// Used for uptime-% math. When a cron fires more than expected (e.g.
// manual triggers), we cap the uptime at 100%.
const EXPECTED_WEEKLY_RUNS: Record<string, number> = {
  "instagram-publish": 7, // daily 08:00
  "instagram-stories": 21, // 3x/day
  "instagram-carousel": 1, // Wed
  "instagram-generate-weekly": 1, // Sun
  "instagram-engagement-digest": 5, // Mon-Fri
  "instagram-dm-followup": 7,
  "instagram-ugc": 7,
  "instagram-analytics": 28, // every 6h
  "instagram-followers": 7,
  "instagram-competitors": 7,
  "instagram-trending": 42, // every 4h
  "instagram-style-preference": 7,
  "instagram-underperformers": 7,
  "instagram-monthly-report": 0.25, // ~1/month
  "instagram-evergreen": 0.25, // ~1/month
  "instagram-health-check": 1, // Mon
  "instagram-fleet-post": 4, // Mon/Wed/Fri/Sun
  "instagram-fleet-story-followup": 56, // every 3h
  // instagram-publish-reel not in schedule yet (reels_enabled=false)
};

type CronStat = {
  name: string;
  success: number;
  error: number;
  skipped: number;
  exception: number;
  timedOut: number;
  totalEnded: number;
  expected: number;
  uptimePct: number;
  errorRatePct: number;
  topErrors: string[];
};

async function _observedImpl() {
  if (Date.now() > SUNSET_AT) {
    return NextResponse.json({
      skipped: "sunsetted",
      note: "Weekly ops report sprint ended 2026-05-04. Extend via new deploy if needed.",
    });
  }

  const sb = createServiceClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  // Pull start + end rows from the last 7 days.
  const [{ data: starts }, { data: ends }] = await Promise.all([
    sb
      .from("settings")
      .select("key, value, updated_at")
      .like("key", "cron_start_%")
      .gt("updated_at", since)
      .limit(5000),
    sb
      .from("settings")
      .select("key, value, updated_at")
      .like("key", "cron_end_%")
      .gt("updated_at", since)
      .limit(5000),
  ]);

  const startRows = (starts ?? [])
    .map((r) => safeParse(r.value))
    .filter((x) => x && x.run_id && x.name);
  const endRows = (ends ?? [])
    .map((r) => safeParse(r.value))
    .filter((x) => x && x.run_id && x.name);

  const endedRunIds = new Set(endRows.map((r) => r.run_id));

  // Group by cron name.
  const byName: Record<
    string,
    {
      starts: any[];
      ends: any[];
      outcomes: { success: number; error: number; skipped: number; exception: number };
      errorReasons: string[];
    }
  > = {};
  const touchCron = (name: string) => {
    if (!byName[name]) {
      byName[name] = {
        starts: [],
        ends: [],
        outcomes: { success: 0, error: 0, skipped: 0, exception: 0 },
        errorReasons: [],
      };
    }
    return byName[name];
  };

  for (const s of startRows) touchCron(s.name).starts.push(s);
  for (const e of endRows) {
    const g = touchCron(e.name);
    g.ends.push(e);
    if (e.outcome === "success") g.outcomes.success++;
    else if (e.outcome === "error") {
      g.outcomes.error++;
      if (e.detail) g.errorReasons.push(String(e.detail));
    } else if (e.outcome === "skipped") g.outcomes.skipped++;
    else if (e.outcome === "exception") {
      g.outcomes.exception++;
      if (e.detail) g.errorReasons.push(String(e.detail));
    }
  }

  const allCronNames = new Set<string>([
    ...Object.keys(byName),
    ...Object.keys(EXPECTED_WEEKLY_RUNS),
  ]);

  const stats: CronStat[] = Array.from(allCronNames)
    .map((name) => {
      const g = byName[name] ?? {
        starts: [],
        ends: [],
        outcomes: { success: 0, error: 0, skipped: 0, exception: 0 },
        errorReasons: [],
      };
      const timedOut = g.starts.filter((s) => !endedRunIds.has(s.run_id)).length;
      const totalEnded =
        g.outcomes.success +
        g.outcomes.error +
        g.outcomes.skipped +
        g.outcomes.exception;
      const expected = EXPECTED_WEEKLY_RUNS[name] ?? 0;
      const completedForUptime = g.outcomes.success + g.outcomes.skipped;
      const uptimePct =
        expected > 0 ? Math.min(100, Math.round((completedForUptime / expected) * 100)) : 0;
      const failedCount = g.outcomes.error + g.outcomes.exception + timedOut;
      const denomForErrorRate = totalEnded + timedOut;
      const errorRatePct =
        denomForErrorRate > 0 ? Math.round((failedCount / denomForErrorRate) * 100) : 0;
      // Top 2 most common error reasons for the regression check.
      const tally: Record<string, number> = {};
      for (const r of g.errorReasons) tally[r] = (tally[r] ?? 0) + 1;
      const topErrors = Object.entries(tally)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([r, c]) => `${r} (×${c})`);
      return {
        name,
        success: g.outcomes.success,
        error: g.outcomes.error,
        skipped: g.outcomes.skipped,
        exception: g.outcomes.exception,
        timedOut,
        totalEnded,
        expected,
        uptimePct,
        errorRatePct,
        topErrors,
      };
    })
    .sort((a, b) => b.errorRatePct - a.errorRatePct || a.name.localeCompare(b.name));

  // Aggregate totals across all crons.
  const totals = stats.reduce(
    (acc, s) => {
      acc.success += s.success;
      acc.error += s.error;
      acc.skipped += s.skipped;
      acc.exception += s.exception;
      acc.timedOut += s.timedOut;
      return acc;
    },
    { success: 0, error: 0, skipped: 0, exception: 0, timedOut: 0 },
  );

  // Regressions: crons with error-rate > 20% AND at least 2 error/timeout
  // events this week (ignore tiny samples).
  const regressions = stats.filter(
    (s) => s.errorRatePct > 20 && s.error + s.exception + s.timedOut >= 2,
  );

  const lines = buildReportLines({ stats, totals, regressions });
  await sendTelegram(lines.join("\n"));

  return NextResponse.json({
    ok: true,
    window_start: since,
    totals,
    stats_count: stats.length,
    regressions: regressions.map((r) => r.name),
  });
}

function buildReportLines(ctx: {
  stats: CronStat[];
  totals: { success: number; error: number; skipped: number; exception: number; timedOut: number };
  regressions: CronStat[];
}): string[] {
  const { stats, totals, regressions } = ctx;
  const totalRuns =
    totals.success + totals.error + totals.skipped + totals.exception + totals.timedOut;

  const lines: string[] = [
    `📊 <b>Weekly Ops Report</b> — last 7 days`,
    ``,
    `<b>Totals across ${stats.length} crons:</b>`,
    `• ✅ success: ${totals.success}`,
    `• ⏭ skipped (flag/cap): ${totals.skipped}`,
    `• ❌ error (handler returned error): ${totals.error}`,
    `• 💥 exception: ${totals.exception}`,
    `• ⏱ timed out (Vercel 504): ${totals.timedOut}`,
    `• 📐 total runs: ${totalRuns}`,
  ];

  // Per-cron block: only show crons that either ran or were expected to run.
  const shown = stats.filter(
    (s) =>
      s.success + s.error + s.skipped + s.exception + s.timedOut > 0 || s.expected > 0,
  );

  lines.push("", "<b>Uptime per cron:</b>");
  for (const s of shown) {
    const bar = s.uptimePct >= 95 ? "🟢" : s.uptimePct >= 80 ? "🟡" : "🔴";
    const parts = [
      `${bar} <code>${s.name}</code>`,
      `${s.uptimePct}% (${s.success}/${s.expected} expected)`,
    ];
    if (s.timedOut > 0) parts.push(`⏱ ${s.timedOut}`);
    if (s.error > 0) parts.push(`❌ ${s.error}`);
    if (s.exception > 0) parts.push(`💥 ${s.exception}`);
    if (s.skipped > 0) parts.push(`⏭ ${s.skipped}`);
    lines.push(parts.join(" · "));
  }

  if (regressions.length > 0) {
    lines.push("", "🚨 <b>Regressions (error rate &gt; 20%):</b>");
    for (const r of regressions) {
      lines.push(
        `• <code>${r.name}</code>: ${r.errorRatePct}% failing`,
      );
      for (const reason of r.topErrors) {
        lines.push(`  └ ${reason}`);
      }
    }
  } else {
    lines.push("", "✅ <i>No regressions detected this week.</i>");
  }

  // Sunset reminder.
  const daysLeft = Math.max(
    0,
    Math.ceil((SUNSET_AT - Date.now()) / 86400000),
  );
  lines.push(
    "",
    `<i>Observability sprint auto-sunsets in ${daysLeft} days (2026-05-04). Extend via code if you want it to keep running.</i>`,
  );

  return lines;
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function GET(...args: any[]) {
  return observeCron(
    "instagram-weekly-ops-report",
    () => (_observedImpl as any)(...args),
  );
}
