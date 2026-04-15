// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

// Cron: daily 08:00 UTC (11:00 Athens).
//
// Feature #10 — Underperformer detection.
//
// Why this is a detection+alert instead of true auto-archive:
// Instagram Graph API does NOT expose an archive endpoint for feed
// posts. The only archive path is the native mobile/web UI. Any
// fully-autonomous archive would need either scraping or a Facebook
// Page token + a Meta-approved internal API — neither of which we
// can ship today.
//
// Instead we ship the detection half: every day we compare posts
// published 14-60 days ago against the median engagement rate of the
// same window, flag any post below 25% of the median, and send a
// Telegram digest with direct links so George can tap-through and
// archive them in 10 seconds.
//
// Dedup: each post gets flagged at most once via a short-lived marker
// in the settings table (key `ig_underperformer_flagged:<media_id>`).

const THRESHOLD_RATIO = 0.25; // "< 25% of median" per the brief
const WINDOW_START_DAYS = 14;
const WINDOW_END_DAYS = 60;
const DEDUP_KEY_PREFIX = "ig_underperformer_flagged:";

export async function GET() {
  const sb = createServiceClient();

  const now = Date.now();
  const windowStart = new Date(now - WINDOW_END_DAYS * 86400000).toISOString();
  const windowEnd = new Date(now - WINDOW_START_DAYS * 86400000).toISOString();

  const { data: analytics, error } = await sb
    .from("ig_post_analytics")
    .select("media_id, permalink, caption, published_at, reach, total_interactions")
    .gte("published_at", windowStart)
    .lte("published_at", windowEnd);

  if (error) {
    return NextResponse.json(
      { error: "analytics query failed", detail: error.message },
      { status: 500 }
    );
  }

  if (!analytics || analytics.length < 5) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `not enough analyzable posts in window — need ≥5, have ${analytics?.length ?? 0}`,
    });
  }

  // Engagement rate per post + median
  const withRate = analytics.map((p) => {
    const reach = Math.max(p.reach ?? 0, 1);
    const rate = (p.total_interactions ?? 0) / reach;
    return { ...p, engagement_rate: rate };
  });
  const sortedRates = [...withRate].map((p) => p.engagement_rate).sort((a, b) => a - b);
  const median =
    sortedRates.length % 2 === 0
      ? (sortedRates[sortedRates.length / 2 - 1] + sortedRates[sortedRates.length / 2]) / 2
      : sortedRates[Math.floor(sortedRates.length / 2)];
  const threshold = median * THRESHOLD_RATIO;

  const underperformers = withRate
    .filter((p) => p.engagement_rate < threshold)
    .sort((a, b) => a.engagement_rate - b.engagement_rate);

  if (underperformers.length === 0) {
    return NextResponse.json({
      ok: true,
      total_analyzed: withRate.length,
      median: Math.round(median * 10000) / 100 + "%",
      threshold: Math.round(threshold * 10000) / 100 + "%",
      underperformers: 0,
      message: "No posts below threshold. 🎉",
    });
  }

  // Dedup — skip any media_id we already flagged in the last 30 days
  const flagKeys = underperformers.map((p) => DEDUP_KEY_PREFIX + p.media_id);
  const { data: existingFlags } = await sb
    .from("settings")
    .select("key, updated_at")
    .in("key", flagKeys);

  const recentlyFlagged = new Set(
    (existingFlags ?? [])
      .filter((f) => {
        const age = now - new Date(f.updated_at).getTime();
        return age < 30 * 86400000;
      })
      .map((f) => f.key.replace(DEDUP_KEY_PREFIX, ""))
  );

  const fresh = underperformers.filter((p) => !recentlyFlagged.has(p.media_id));

  if (fresh.length === 0) {
    return NextResponse.json({
      ok: true,
      total_analyzed: withRate.length,
      underperformers: underperformers.length,
      fresh: 0,
      reason: "all underperformers already flagged recently",
    });
  }

  // Build Telegram digest — cap at 5 so the message stays readable
  const top5 = fresh.slice(0, 5);
  const lines = [
    "📉 <b>Underperformer alert</b>",
    `<i>${top5.length} post${top5.length > 1 ? "s" : ""} below ${Math.round(THRESHOLD_RATIO * 100)}% of the ${WINDOW_START_DAYS}-${WINDOW_END_DAYS}d median engagement rate (${(median * 100).toFixed(2)}%).</i>`,
    "<i>Archive from IG mobile/web — the API doesn't expose programmatic archive.</i>",
    "",
  ];

  for (const p of top5) {
    const firstLine = (p.caption ?? "").split("\n")[0].slice(0, 70);
    const rate = (p.engagement_rate * 100).toFixed(2);
    const date = (p.published_at ?? "").slice(0, 10);
    if (p.permalink) {
      lines.push(`• <a href="${p.permalink}">${date}</a> — ${rate}%\n  <i>${firstLine}</i>`);
    } else {
      lines.push(`• ${date} — ${rate}%\n  <i>${firstLine}</i>`);
    }
  }

  await sendTelegram(lines.join("\n")).catch(() => {});

  // Record dedup markers so we don't ping George about the same post
  // again for 30 days
  await sb
    .from("settings")
    .upsert(
      top5.map((p) => ({
        key: DEDUP_KEY_PREFIX + p.media_id,
        value: JSON.stringify({
          rate: p.engagement_rate,
          flagged_at: new Date().toISOString(),
        }),
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "key" }
    )
    .catch(() => {});

  return NextResponse.json({
    ok: true,
    total_analyzed: withRate.length,
    median_rate: (median * 100).toFixed(2) + "%",
    threshold_rate: (threshold * 100).toFixed(2) + "%",
    underperformers_total: underperformers.length,
    fresh_flagged: top5.length,
    top5: top5.map((p) => ({
      media_id: p.media_id,
      engagement_rate: (p.engagement_rate * 100).toFixed(2) + "%",
      caption_preview: (p.caption ?? "").slice(0, 60),
    })),
  });
}
