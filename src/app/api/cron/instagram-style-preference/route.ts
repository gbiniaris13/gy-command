// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { observeCron } from "@/lib/cron-observer";

// Cron: daily 09:00 UTC (12:00 Athens).
//
// Feature #7 — A/B style tester.
//
// Reads the last 30 days of AI-generated posts that have a style tag
// in ig_posts.metadata.style + a matching analytics row in
// ig_post_analytics, groups by style, computes median engagement rate
// per style, and writes the winning style into
// settings.ig_preferred_style. The weekly generator reads that key and
// biases the next Gemini prompt toward the winning style.
//
// Graceful no-op when we don't yet have enough style data.
//
// "Style" values are set by the weekly generator — one of:
//   story, data, personal, educational, reflective, behind_scenes,
//   island_guide, lifestyle

const WINDOW_DAYS = 30;
const MIN_POSTS_PER_STYLE = 2;
const PREFERRED_STYLE_KEY = "ig_preferred_style";

async function _observedImpl() {
  const sb = createServiceClient();

  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();

  // Get AI-tagged posts from the last 30 days
  const { data: posts } = await sb
    .from("ig_posts")
    .select("id, ig_media_id, metadata, published_at")
    .not("ig_media_id", "is", null)
    .gte("published_at", since);

  const tagged = (posts ?? []).filter((p) => p.metadata?.style);
  if (tagged.length < MIN_POSTS_PER_STYLE * 3) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `need at least ${MIN_POSTS_PER_STYLE * 3} AI-tagged posts in last ${WINDOW_DAYS}d, have ${tagged.length}`,
    });
  }

  // Fetch matching analytics rows
  const mediaIds = tagged.map((p) => p.ig_media_id);
  const { data: analytics } = await sb
    .from("ig_post_analytics")
    .select("media_id, reach, total_interactions")
    .in("media_id", mediaIds);

  const analyticsByMedia = new Map(
    (analytics ?? []).map((a) => [a.media_id, a])
  );

  // Group engagement rates by style
  const byStyle = new Map<string, number[]>();
  for (const p of tagged) {
    const a = analyticsByMedia.get(p.ig_media_id);
    if (!a) continue;
    const reach = Math.max(a.reach ?? 0, 1);
    const rate = (a.total_interactions ?? 0) / reach;
    const style = String(p.metadata.style);
    if (!byStyle.has(style)) byStyle.set(style, []);
    byStyle.get(style)!.push(rate);
  }

  if (byStyle.size === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "no style-tagged posts have analytics yet",
    });
  }

  // Compute median per style, require MIN_POSTS_PER_STYLE samples
  const ranking: Array<{
    style: string;
    median_rate: number;
    sample_size: number;
  }> = [];
  for (const [style, rates] of byStyle.entries()) {
    if (rates.length < MIN_POSTS_PER_STYLE) continue;
    const sorted = [...rates].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    ranking.push({ style, median_rate: median, sample_size: rates.length });
  }
  ranking.sort((a, b) => b.median_rate - a.median_rate);

  if (ranking.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `no style has at least ${MIN_POSTS_PER_STYLE} analytics rows yet`,
    });
  }

  const winner = ranking[0];
  const payload = {
    style: winner.style,
    median_rate: winner.median_rate,
    sample_size: winner.sample_size,
    ranking,
    computed_at: new Date().toISOString(),
  };

  await sb
    .from("settings")
    .upsert(
      {
        key: PREFERRED_STYLE_KEY,
        value: JSON.stringify(payload),
        updated_at: payload.computed_at,
      },
      { onConflict: "key" }
    );

  return NextResponse.json({
    ok: true,
    winner_style: winner.style,
    winner_median_rate: (winner.median_rate * 100).toFixed(2) + "%",
    ranking: ranking.map((r) => ({
      style: r.style,
      median: (r.median_rate * 100).toFixed(2) + "%",
      samples: r.sample_size,
    })),
  });
}


// Observability wrapper — records success/error/skipped/timeout
// outcomes to settings KV for the Thursday ops report.
export async function GET(...args: any[]) {
  return observeCron("instagram-style-preference", () => (_observedImpl as any)(...args));
}
