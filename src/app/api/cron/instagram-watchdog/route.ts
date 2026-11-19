// Daily Instagram-pipeline watchdog — runs every morning ~06:30 UTC.
//
// Why this exists: the weekly generator (instagram-generate-weekly) is
// scheduled for Sunday 07:00 UTC, but Vercel sometimes silently skips
// individual cron firings (project hit a 14-day silent-skip incident
// 2026-04-14 → 2026-04-28 that left the queue empty for 6 days). This
// watchdog is the safety net — if posts ahead < N OR last published
// stale > N days, it kicks the generator(s) itself.
//
// Idempotent: each downstream generator already has a per-day
// idempotency check, so calling it on a healthy day is a no-op.
//
// Auto-DRAFT only — never bypasses the approval gate. The generator
// still goes through enqueuePendingApproval() → Telegram buttons →
// George's hand on the keyboard.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import { emailGeorgeReport } from "@/lib/email-tracking";
import { missedPostingDays, buildSilenceAlert, tallyCauses } from "@/lib/ig-silence";

export const runtime = "nodejs";
export const maxDuration = 60;

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://command.georgeyachts.com";

const STALENESS_THRESHOLD_DAYS = 3;
const QUEUE_DEPTH_THRESHOLD = 3;

async function postsAhead(
  sb: ReturnType<typeof createServiceClient>,
  daysAhead: number,
): Promise<{ scheduled: number; pending: number }> {
  const now = new Date();
  const horizon = new Date(now.getTime() + daysAhead * 86400 * 1000);
  const { count: scheduled } = await sb
    .from("ig_posts")
    .select("id", { count: "exact", head: true })
    .eq("status", "scheduled")
    .gte("schedule_time", now.toISOString())
    .lte("schedule_time", horizon.toISOString());
  const { count: pending } = await sb
    .from("ig_posts")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_approval")
    .gte("schedule_time", now.toISOString())
    .lte("schedule_time", horizon.toISOString());
  return { scheduled: scheduled ?? 0, pending: pending ?? 0 };
}

async function lastPublishedAt(
  sb: ReturnType<typeof createServiceClient>,
): Promise<string | null> {
  const { data } = await sb
    .from("ig_posts")
    .select("published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.published_at as string | null) ?? null;
}

// Mondays and Saturdays the publisher skipped on purpose (the stealth
// roll in meta-stealth.ts). Those are not missed posts.
async function stealthSkippedDays(
  sb: ReturnType<typeof createServiceClient>,
): Promise<Set<string>> {
  const prefix = "stealth_skip_post_publish_";
  const { data } = await sb
    .from("settings")
    .select("key, value")
    .like("key", `${prefix}%`)
    .eq("value", "skipped");
  return new Set((data ?? []).map((r) => String(r.key).slice(prefix.length)));
}

// What the feed crons reported over the silent stretch, so the alarm can
// say why and not only that. Reads the cron-observer END rows.
const FEED_CRONS = ["instagram-fleet-post", "instagram-publish", "instagram-generate-weekly"];
async function feedCronCauses(
  sb: ReturnType<typeof createServiceClient>,
  sinceIso: string,
): Promise<string[]> {
  const runs: Array<{ name: string; outcome: string; detail?: string | null }> = [];
  for (const name of FEED_CRONS) {
    const { data } = await sb
      .from("settings")
      .select("value")
      .like("key", "cron_end_%")
      .like("value", `%"name":"${name}"%`)
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false })
      .limit(40);
    for (const row of data ?? []) {
      try {
        const v = JSON.parse(String(row.value));
        runs.push({ name, outcome: String(v.outcome ?? "unknown"), detail: v.detail ?? null });
      } catch {
        // an unreadable row is not a cause
      }
    }
  }
  return tallyCauses(runs);
}

async function fireGenerateWeekly(week: "current" | "next"): Promise<{
  ok: boolean;
  body: any;
}> {
  try {
    const res = await fetch(
      `${SITE}/api/cron/instagram-generate-weekly?week=${week}`,
      // The cron lock (middleware.ts) refuses calls without the secret.
      { method: "GET", headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } },
    );
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body };
  } catch (err) {
    return {
      ok: false,
      body: { error: err instanceof Error ? err.message : "fetch failed" },
    };
  }
}

async function _observedImpl() {
  const sb = createServiceClient();

  const ahead = await postsAhead(sb, 7);
  const lastPub = await lastPublishedAt(sb);
  const staleDays = lastPub
    ? Math.floor(
        (Date.now() - new Date(lastPub).getTime()) / 86_400_000,
      )
    : 999;

  const queueDepth = ahead.scheduled + ahead.pending;
  const stale = staleDays > STALENESS_THRESHOLD_DAYS;
  const queueLow = queueDepth < QUEUE_DEPTH_THRESHOLD;

  const triggers: string[] = [];
  let currentWeekResult: any = null;
  let nextWeekResult: any = null;

  if (queueLow || stale) {
    triggers.push(
      stale ? `last_published ${staleDays}d ago` : `queue depth ${queueDepth}`,
    );

    // Fire current-week first so today/tomorrow can still publish if
    // the captions get approved fast.
    currentWeekResult = await fireGenerateWeekly("current");
    nextWeekResult = await fireGenerateWeekly("next");

    const currentInserted = currentWeekResult?.body?.inserted ?? 0;
    const nextInserted = nextWeekResult?.body?.inserted ?? 0;
    if (currentInserted + nextInserted > 0) {
      await sendTelegram(
        `🛟 <b>IG watchdog auto-triggered</b>\n` +
          `Reason: ${triggers.join(", ")}\n` +
          `Current week: ${currentInserted} captions queued for approval\n` +
          `Next week: ${nextInserted} captions queued for approval\n` +
          `Tap ✅ on the Telegram cards to schedule.`,
      ).catch(() => {});
    }
  }

  // 2026-11-19: the silence alarm. Everything above tries to refill the
  // queue and stays quiet when that fails, which is how the feed sat
  // dead from 24 October to 19 November with nobody told. This part
  // only looks at the outcome: was a feed post due and did none go out?
  // One missed day is a Telegram notice; two or more is an alarm on
  // Telegram and by email, every morning until a post goes out.
  let silence: { level: string; missed: string[]; emailed?: boolean } = { level: "none", missed: [] };
  try {
    const now = new Date();
    const missed = missedPostingDays({
      lastPublishedAt: lastPub,
      now,
      skipped: await stealthSkippedDays(sb),
    });
    if (missed.length > 0) {
      const since = new Date(
        Math.max(new Date(`${missed[0]}T00:00:00Z`).getTime(), now.getTime() - 7 * 86_400_000),
      ).toISOString();
      const after = await postsAhead(sb, 7);
      const alert = buildSilenceAlert({
        missed,
        lastPublishedAt: lastPub,
        now,
        causes: await feedCronCauses(sb, since),
        queued: after.scheduled + after.pending,
      });
      await sendTelegram(alert.telegram).catch(() => {});
      const emailed =
        alert.level === "alarm" ? await emailGeorgeReport(alert.subject, alert.body) : undefined;
      silence = { level: alert.level, missed, emailed };
    }
  } catch (err) {
    // The alarm must never be the thing that fails silently.
    await sendTelegram(
      `🚨 <b>IG silence check crashed</b>\n<code>${String(
        err instanceof Error ? err.message : err,
      ).slice(0, 300)}</code>`,
    ).catch(() => {});
    silence = { level: "check_failed", missed: [] };
  }

  return NextResponse.json({
    ok: true,
    queue: { scheduled: ahead.scheduled, pending_approval: ahead.pending },
    last_published_days_ago: staleDays,
    silence,
    triggers,
    current_week: currentWeekResult,
    next_week: nextWeekResult,
  });
}

export async function GET() {
  return observeCron("instagram-watchdog", () => _observedImpl());
}
