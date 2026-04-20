// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

// Cron: Monday 07:00 UTC (10:00 Athens) — weekly account health check.
//
// Roberto brief v3 — Phase 5 (Account Health Monitoring).
//
// Pulls the live IG account fields + compares this week's engagement
// vs last week. Flags the result GREEN / YELLOW / RED, reports via
// Telegram, and if RED flips the global `settings.crons_paused = true`
// switch so all outbound automation stops until George reviews the
// account manually.
//
// Tiers:
//   GREEN  — no concerns
//   YELLOW — 1-2 yellow flags (notable but not dangerous)
//   RED    — any single RED flag OR ≥3 yellow flags → auto-pause all crons
//
// Tier-sensitive metric (per George): HOT-classified DMs and Calendly
// bookings are the primary funnel metric. Engagement rate alone is a
// vanity metric for luxury B2B. We still report engagement because
// it's a useful *direction* signal, but the RED trigger for that is
// set very loose — only catches catastrophic drops.

const WINDOW_MS_7D = 7 * 24 * 60 * 60 * 1000;

type Health = {
  level: "GREEN" | "YELLOW" | "RED";
  flags: string[];
  metrics: {
    followers_now: number;
    followers_last_week: number;
    followers_delta: number;
    followers_delta_pct: number;
    hot_dms_this_week: number;
    hot_dms_last_week: number;
    engagement_rate_this_week: number | null;
    engagement_rate_last_week: number | null;
    posts_this_week: number;
  };
};

export async function GET() {
  const igToken = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return NextResponse.json({ error: "IG not configured" });
  }

  const sb = createServiceClient();

  const health = await computeHealth(sb, igToken);
  await persistBaselines(sb, health);
  await applyAutoPause(sb, health);
  const tierAction = await maybeAutoDowngradeTier(sb, health);
  await reportToTelegram(health, tierAction);

  return NextResponse.json({ ok: true, ...health, tierAction });
}

/**
 * Phase B — auto-tier-downgrade.
 *
 * Per George's stated success metric: HOT-classified DMs are the
 * primary signal, NOT engagement rate. If HOT DMs drop >50% week-over-
 * week AND we published ≥7 posts this week (so it's not a
 * low-activity artifact), auto-downgrade content_tier by one step
 * and Telegram the change.
 *
 * Tiers: 1.5 (current cautious launch) → 2 → 3 (max aggressive).
 * Downgrade floor is tier 1 (baseline). Upgrade is NEVER automatic —
 * that's a manual George decision after reviewing HOT DM trend.
 */
async function maybeAutoDowngradeTier(
  sb: any,
  health: Health,
): Promise<{ downgraded: boolean; from?: string; to?: string; reason?: string }> {
  const { hot_dms_this_week, hot_dms_last_week, posts_this_week } = health.metrics;

  // Guard against noise from low-activity weeks.
  if (posts_this_week < 7) {
    return { downgraded: false, reason: "low activity week — skipping" };
  }
  // Need at least 3 HOT DMs baseline to compute a meaningful drop.
  if (hot_dms_last_week < 3) {
    return { downgraded: false, reason: "baseline too small" };
  }
  // 50% threshold per George's "HOT-flat or down → hold tier" stance.
  if (hot_dms_this_week >= hot_dms_last_week * 0.5) {
    return { downgraded: false };
  }

  // Pull current tier (default 1).
  const { data: tierRow } = await sb
    .from("settings")
    .select("value")
    .eq("key", "content_tier")
    .maybeSingle();
  const currentTier = Number(tierRow?.value ?? 1);
  if (currentTier <= 1) {
    return {
      downgraded: false,
      reason: "already at tier 1 baseline — cannot go lower",
    };
  }

  const newTier = Math.max(1, currentTier - 1);
  try {
    await sb.from("settings").upsert(
      {
        key: "content_tier",
        value: String(newTier),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {}
  try {
    await sb.from("settings").upsert(
      {
        key: "content_tier_history",
        value: JSON.stringify({
          downgraded_at: new Date().toISOString(),
          from: currentTier,
          to: newTier,
          reason: `HOT DMs ${hot_dms_this_week}/${hot_dms_last_week} — dropped >50%`,
        }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {}

  return {
    downgraded: true,
    from: String(currentTier),
    to: String(newTier),
    reason: `HOT DMs dropped ${hot_dms_this_week}/${hot_dms_last_week} week-over-week`,
  };
}

async function computeHealth(sb: any, igToken: string): Promise<Health> {
  const flags: string[] = [];

  // 1. Follower deltas
  const followersNow = await fetchFollowerCount(igToken);
  const followersLastWeek = await fetchFollowersLastWeek(sb);
  const followersDelta = followersNow - followersLastWeek;
  const followersDeltaPct =
    followersLastWeek > 0 ? (followersDelta / followersLastWeek) * 100 : 0;

  if (followersDeltaPct < -2) {
    flags.push(`RED: followers dropped ${followersDeltaPct.toFixed(1)}% in 7d`);
  } else if (followersDeltaPct < 0) {
    flags.push(`YELLOW: followers dipped ${followersDeltaPct.toFixed(1)}% in 7d`);
  }

  // 2. HOT DM funnel — primary success metric per George
  const hotDmsThisWeek = await countHotDms(sb, WINDOW_MS_7D);
  const hotDmsLastWeek = await countHotDms(sb, WINDOW_MS_7D, WINDOW_MS_7D);
  if (hotDmsLastWeek >= 3 && hotDmsThisWeek < hotDmsLastWeek * 0.5) {
    flags.push(
      `RED: HOT DMs down ${hotDmsThisWeek}/${hotDmsLastWeek} — funnel signal lost`,
    );
  } else if (hotDmsLastWeek >= 3 && hotDmsThisWeek < hotDmsLastWeek * 0.8) {
    flags.push(`YELLOW: HOT DMs dipped ${hotDmsThisWeek}/${hotDmsLastWeek}`);
  }

  // 3. Engagement rate (direction signal only)
  const engThisWeek = await avgEngagementRate(sb, 0, WINDOW_MS_7D);
  const engLastWeek = await avgEngagementRate(sb, WINDOW_MS_7D, WINDOW_MS_7D * 2);
  if (
    engThisWeek !== null &&
    engLastWeek !== null &&
    engLastWeek > 0 &&
    engThisWeek < engLastWeek * 0.5
  ) {
    flags.push(
      `RED: engagement rate halved (${fmtPct(engLastWeek)} → ${fmtPct(engThisWeek)})`,
    );
  } else if (
    engThisWeek !== null &&
    engLastWeek !== null &&
    engLastWeek > 0 &&
    engThisWeek < engLastWeek * 0.75
  ) {
    flags.push(
      `YELLOW: engagement rate down ≥25% (${fmtPct(engLastWeek)} → ${fmtPct(engThisWeek)})`,
    );
  }

  // 4. Zero reach for last 3 posts = possible shadowban signal
  const zeroReachStreak = await checkZeroReach(sb);
  if (zeroReachStreak >= 3) {
    flags.push(
      `RED: last ${zeroReachStreak} posts have ~zero reach — possible shadowban`,
    );
  }

  // 5. Posts published count (sanity check the pipeline is alive)
  const postsThisWeek = await countPostsPublished(sb, WINDOW_MS_7D);
  if (postsThisWeek === 0) {
    flags.push(`YELLOW: zero posts published last 7 days — cron stuck?`);
  }

  // Classify overall
  const reds = flags.filter((f) => f.startsWith("RED:")).length;
  const yellows = flags.filter((f) => f.startsWith("YELLOW:")).length;
  let level: Health["level"];
  if (reds > 0 || yellows >= 3) level = "RED";
  else if (yellows > 0) level = "YELLOW";
  else level = "GREEN";

  return {
    level,
    flags,
    metrics: {
      followers_now: followersNow,
      followers_last_week: followersLastWeek,
      followers_delta: followersDelta,
      followers_delta_pct: followersDeltaPct,
      hot_dms_this_week: hotDmsThisWeek,
      hot_dms_last_week: hotDmsLastWeek,
      engagement_rate_this_week: engThisWeek,
      engagement_rate_last_week: engLastWeek,
      posts_this_week: postsThisWeek,
    },
  };
}

async function applyAutoPause(sb: any, health: Health): Promise<void> {
  if (health.level !== "RED") return;

  // Set the global crons_paused flag. The rate-limit-guard reads this
  // on every invocation and short-circuits, so every outbound cron
  // stops within one tick. Webhooks keep responding (replies in-flight
  // are OK; the guard there only stops NEW outbound actions).
  try {
    await sb.from("settings").upsert(
      {
        key: "crons_paused",
        value: "true",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {}

  // Also persist a reason + timestamp so the dashboard can explain
  // the pause later.
  try {
    await sb.from("settings").upsert(
      {
        key: "crons_paused_reason",
        value: JSON.stringify({
          paused_at: new Date().toISOString(),
          flags: health.flags,
        }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {}
}

async function persistBaselines(sb: any, health: Health): Promise<void> {
  // Snapshot this week's follower count for next week's comparison.
  try {
    await sb.from("ig_follower_history").insert({
      follower_count: health.metrics.followers_now,
      recorded_at: new Date().toISOString(),
      source: "health_check",
    });
  } catch {}
}

async function reportToTelegram(
  health: Health,
  tierAction?: { downgraded: boolean; from?: string; to?: string; reason?: string },
): Promise<void> {
  const emoji =
    health.level === "GREEN" ? "✅" : health.level === "YELLOW" ? "⚠" : "🚨";
  const lines = [
    `${emoji} <b>Weekly Account Health — ${health.level}</b>`,
    ``,
    `<b>Followers</b>: ${health.metrics.followers_now.toLocaleString()} ` +
      `(${health.metrics.followers_delta >= 0 ? "+" : ""}${health.metrics.followers_delta} in 7d, ` +
      `${health.metrics.followers_delta_pct >= 0 ? "+" : ""}${health.metrics.followers_delta_pct.toFixed(1)}%)`,
    `<b>HOT DMs this week</b>: ${health.metrics.hot_dms_this_week} ` +
      `(last week: ${health.metrics.hot_dms_last_week})`,
    `<b>Posts published</b>: ${health.metrics.posts_this_week}`,
    health.metrics.engagement_rate_this_week !== null
      ? `<b>Engagement rate</b>: ${fmtPct(health.metrics.engagement_rate_this_week)} ` +
        `(last week: ${health.metrics.engagement_rate_last_week !== null ? fmtPct(health.metrics.engagement_rate_last_week) : "n/a"})`
      : `<b>Engagement rate</b>: not enough data`,
  ];

  if (health.flags.length > 0) {
    lines.push("", "<b>Flags:</b>");
    for (const f of health.flags) lines.push(`• ${f}`);
  }

  if (tierAction?.downgraded) {
    lines.push(
      "",
      `📉 <b>Auto-downgraded content tier:</b> ${tierAction.from} → ${tierAction.to}`,
      `<i>${tierAction.reason}</i>`,
      "Manual override: upsert settings.content_tier via dashboard.",
    );
  }

  if (health.level === "RED") {
    lines.push(
      "",
      "🚨 <b>Auto-paused all outbound crons.</b>",
      "Webhooks (comment + DM auto-reply) still work.",
      "",
      "Recovery checklist:",
      "1. Open IG → Profile → Settings → Account Status — screenshot any warnings",
      "2. Review low-performing posts from last 7 days",
      "3. Once clear, flip <code>settings.crons_paused = false</code> from the dashboard",
    );
  }

  // One-shot infrastructure callout (per George 2026-04-20). Expires
  // after the first Monday past 2026-05-04 so the note shows on the
  // next 1-2 weekly reports and then disappears forever.
  const INFRA_NOTE_EXPIRES = new Date("2026-05-04T23:59:59Z").getTime();
  if (Date.now() < INFRA_NOTE_EXPIRES) {
    lines.push(
      "",
      "🔧 <b>Infra note (one-time):</b>",
      "Fixed 2026-04-20: Vercel serverless function cap was silently killing ~40% of publish / stories / carousel invocations for the past week (504 timeout inside the 0-900s jitter window). Engagement numbers above compare against that artificially-low baseline — expect a natural bump this week as the fix takes effect.",
    );
  }

  await sendTelegram(lines.join("\n"));
}

// ─────────────────────────────────────────────────────────────────────
// Helpers (data fetchers)
// ─────────────────────────────────────────────────────────────────────

async function fetchFollowerCount(igToken: string): Promise<number> {
  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=followers_count&access_token=${encodeURIComponent(igToken)}`,
    );
    const json = await res.json();
    return Number(json?.followers_count ?? 0);
  } catch {
    return 0;
  }
}

async function fetchFollowersLastWeek(sb: any): Promise<number> {
  const cutoff = new Date(Date.now() - WINDOW_MS_7D).toISOString();
  const { data } = await sb
    .from("ig_follower_history")
    .select("follower_count")
    .lt("recorded_at", cutoff)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number(data?.follower_count ?? 0);
}

async function countHotDms(
  sb: any,
  windowMs: number,
  offsetMs = 0,
): Promise<number> {
  const end = new Date(Date.now() - offsetMs).toISOString();
  const start = new Date(Date.now() - offsetMs - windowMs).toISOString();
  const { count } = await sb
    .from("ig_dm_replies")
    .select("*", { count: "exact", head: true })
    .eq("intent", "hot")
    .gte("sent_at", start)
    .lt("sent_at", end);
  return count ?? 0;
}

async function avgEngagementRate(
  sb: any,
  offsetMs: number,
  windowMs: number,
): Promise<number | null> {
  const end = new Date(Date.now() - offsetMs).toISOString();
  const start = new Date(Date.now() - offsetMs - windowMs).toISOString();
  const { data } = await sb
    .from("ig_post_analytics")
    .select("engagement_rate")
    .gte("recorded_at", start)
    .lt("recorded_at", end);
  if (!data || data.length === 0) return null;
  const rates = data
    .map((r: any) => Number(r.engagement_rate))
    .filter((n: number) => !Number.isNaN(n) && n >= 0);
  if (rates.length === 0) return null;
  return rates.reduce((a: number, b: number) => a + b, 0) / rates.length;
}

async function checkZeroReach(sb: any): Promise<number> {
  const { data } = await sb
    .from("ig_post_analytics")
    .select("reach, recorded_at")
    .order("recorded_at", { ascending: false })
    .limit(3);
  if (!data || data.length === 0) return 0;
  let streak = 0;
  for (const row of data) {
    if (Number(row.reach ?? 0) === 0) streak++;
    else break;
  }
  return streak;
}

async function countPostsPublished(sb: any, windowMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const { count } = await sb
    .from("ig_posts")
    .select("*", { count: "exact", head: true })
    .eq("status", "published")
    .gte("published_at", cutoff);
  return count ?? 0;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}
