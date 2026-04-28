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

async function fireGenerateWeekly(week: "current" | "next"): Promise<{
  ok: boolean;
  body: any;
}> {
  try {
    const res = await fetch(
      `${SITE}/api/cron/instagram-generate-weekly?week=${week}`,
      { method: "GET" },
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

  return NextResponse.json({
    ok: true,
    queue: { scheduled: ahead.scheduled, pending_approval: ahead.pending },
    last_published_days_ago: staleDays,
    triggers,
    current_week: currentWeekResult,
    next_week: nextWeekResult,
  });
}

export async function GET() {
  return observeCron("instagram-watchdog", () => _observedImpl());
}
