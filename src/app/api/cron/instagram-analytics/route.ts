// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { observeCron } from "@/lib/cron-observer";
import { getIgTokenOptional, getIgGraphRoot } from "@/lib/ig-token";
import { CTA_LOG_KEY, mergeInsights, type CtaLogEntry, type StoryInsights } from "@/lib/story-cta";

// Vercel cron — pulls insights for every post published in the last 7
// days and upserts them into ig_post_analytics. Runs every 6 hours so
// the dashboard has rolling 24h / 48h / 7d numbers without being close
// enough to the IG rate limit to sting.

const LOOKBACK_DAYS = 7;

// Metric sets differ per media type. FEED posts (IMAGE/CAROUSEL) and
// REELS expose different metric names in the v21.0 Insights API, so we
// request per-type.
const METRICS_BY_TYPE: Record<string, string[]> = {
  IMAGE: ["reach", "likes", "comments", "saved", "shares", "profile_visits", "total_interactions"],
  CAROUSEL_ALBUM: ["reach", "likes", "comments", "saved", "shares", "profile_visits", "total_interactions"],
  VIDEO: ["reach", "likes", "comments", "saved", "shares", "profile_visits", "total_interactions", "views"],
  REELS: ["reach", "likes", "comments", "saved", "shares", "profile_visits", "total_interactions", "views"],
};

interface InsightRow {
  name: string;
  values?: Array<{ value: number }>;
}

function valueOf(rows: InsightRow[], name: string): number {
  const row = rows.find((r) => r.name === name);
  return row?.values?.[0]?.value ?? 0;
}

// 2026-11-19: numbers for the stories that are live right now, for the
// call-to-action test (src/lib/story-cta.ts). A story's insights vanish
// with the story after 24 hours, so they are read on every run (every six
// hours) and the highest reading is kept. Each metric is asked for on its
// own: Meta renames story metrics between API versions, and one unknown
// name in a combined request fails the whole request.
const STORY_METRICS = [
  "reach",
  "replies",
  "profile_visits",
  "follows",
  "shares",
  "total_interactions",
  "navigation",
  "views",
  "profile_activity",
] as const;

function metricValue(row: any): number | null {
  const v = row?.values?.[0]?.value ?? row?.total_value?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function collectStoryInsights(
  sb: ReturnType<typeof createServiceClient>,
  token: string,
): Promise<{ live: number; matched: number; metrics_ok: string[]; metrics_failed: Record<string, string> }> {
  const out = { live: 0, matched: 0, metrics_ok: [] as string[], metrics_failed: {} as Record<string, string> };
  const listRes = await fetch(
    `${getIgGraphRoot()}/stories?fields=id,timestamp&access_token=${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  const list = await listRes.json().catch(() => ({}));
  if (!listRes.ok || !Array.isArray(list?.data)) {
    out.metrics_failed.stories_list = String(list?.error?.message ?? `HTTP ${listRes.status}`).slice(0, 160);
    return out;
  }
  out.live = list.data.length;
  if (out.live === 0) return out;

  const { data: row } = await sb.from("settings").select("value").eq("key", CTA_LOG_KEY).maybeSingle();
  let log: CtaLogEntry[] = [];
  try {
    const parsed = JSON.parse((row?.value as string) ?? "[]");
    if (Array.isArray(parsed)) log = parsed;
  } catch {}

  // Every live story is read, including any published before the test
  // began, so each run reports which metric names Meta currently accepts.
  const ok = new Set<string>();
  for (const story of list.data as Array<{ id: string }>) {
    const fresh: StoryInsights = { fetched_at: new Date().toISOString() };
    await Promise.all(
      STORY_METRICS.map(async (metric) => {
        try {
          const res = await fetch(
            `https://graph.facebook.com/v21.0/${story.id}/insights?metric=${metric}&access_token=${encodeURIComponent(token)}`,
            { cache: "no-store" },
          );
          const json = await res.json();
          const value = res.ok ? metricValue(json?.data?.[0]) : null;
          if (value === null) {
            out.metrics_failed[metric] = String(json?.error?.message ?? "no value").slice(0, 160);
            return;
          }
          (fresh as Record<string, unknown>)[metric] = value;
          ok.add(metric);
        } catch (err) {
          out.metrics_failed[metric] = err instanceof Error ? err.message.slice(0, 160) : "fetch failed";
        }
      }),
    );
    const merged = mergeInsights(log, String(story.id), fresh);
    log = merged.log;
    if (merged.matched) out.matched += 1;
  }
  out.metrics_ok = [...ok];
  if (out.matched > 0) {
    const now = new Date().toISOString();
    await sb
      .from("settings")
      .upsert({ key: CTA_LOG_KEY, value: JSON.stringify(log), updated_at: now }, { onConflict: "key" });
  }
  return out;
}

async function _observedImpl() {
  const token = getIgTokenOptional();
  const igId = process.env.IG_BUSINESS_ID;
  if (!token || !igId) {
    return NextResponse.json({ error: "IG not configured" }, { status: 500 });
  }

  const sb = createServiceClient();
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  // 1. Pull the recent media list
  let posts: any[] = [];
  try {
    const res = await fetch(
      `${getIgGraphRoot()}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=50&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `IG media list ${res.status}` },
        { status: 502 }
      );
    }
    const data = await res.json();
    posts = (data.data ?? []).filter((p: any) => {
      const ts = p.timestamp ? new Date(p.timestamp).getTime() : 0;
      return ts >= cutoff;
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list fetch failed" },
      { status: 502 }
    );
  }

  // 2. Fetch insights for each post in parallel (capped), then upsert.
  const results: Array<{ media_id: string; ok: boolean; reason?: string }> = [];

  const fetchInsights = async (post: any) => {
    const type = (post.media_type ?? "IMAGE").toUpperCase();
    const metrics = METRICS_BY_TYPE[type] ?? METRICS_BY_TYPE.IMAGE;
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${post.id}/insights?metric=${metrics.join(",")}&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok || !Array.isArray(json.data)) {
        results.push({
          media_id: post.id,
          ok: false,
          reason: json?.error?.message ?? `HTTP ${res.status}`,
        });
        return;
      }
      const rows: InsightRow[] = json.data;

      const analyticsRow = {
        media_id: post.id,
        permalink: post.permalink ?? null,
        caption: post.caption ?? null,
        media_type: post.media_type ?? null,
        media_url: post.media_url ?? null,
        thumbnail_url: post.thumbnail_url ?? null,
        published_at: post.timestamp ?? null,
        reach: valueOf(rows, "reach"),
        // impressions is deprecated in v21+; keep the column, store 0.
        impressions: valueOf(rows, "impressions"),
        // IG Insights uses "saved" — expose as "saves" in our schema.
        likes: valueOf(rows, "likes") || post.like_count || 0,
        comments: valueOf(rows, "comments") || post.comments_count || 0,
        saves: valueOf(rows, "saved"),
        shares: valueOf(rows, "shares"),
        profile_visits: valueOf(rows, "profile_visits"),
        total_interactions: valueOf(rows, "total_interactions"),
        fetched_at: new Date().toISOString(),
      };

      const { error } = await sb
        .from("ig_post_analytics")
        .upsert(analyticsRow, { onConflict: "media_id" });

      if (error) {
        results.push({ media_id: post.id, ok: false, reason: error.message });
      } else {
        results.push({ media_id: post.id, ok: true });
      }
    } catch (err) {
      results.push({
        media_id: post.id,
        ok: false,
        reason: err instanceof Error ? err.message : "insights fetch failed",
      });
    }
  };

  // Run in small batches so we don't hammer the IG API all at once.
  const BATCH = 4;
  for (let i = 0; i < posts.length; i += BATCH) {
    await Promise.all(posts.slice(i, i + BATCH).map(fetchInsights));
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  // Stories never fail the post analytics above: report, do not throw.
  let stories: Awaited<ReturnType<typeof collectStoryInsights>> | { error: string };
  try {
    stories = await collectStoryInsights(sb, token);
  } catch (err) {
    stories = { error: err instanceof Error ? err.message : "story insights failed" };
  }

  return NextResponse.json({
    ok,
    failed: failed.length,
    total: posts.length,
    failures: failed.slice(0, 5), // trim to avoid noisy payloads
    stories,
  });
}


// Observability wrapper — records success/error/skipped/timeout
// outcomes to settings KV for the Thursday ops report.
export async function GET(...args: any[]) {
  return observeCron("instagram-analytics", () => (_observedImpl as any)(...args));
}
