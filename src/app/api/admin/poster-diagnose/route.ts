// Read-only auto-poster diagnostic.
//
// George reports posts haven't gone out for ~5 days. This endpoint
// answers, in one call:
//   - is the global crons_paused flag set? (if yes → why)
//   - are IG_ACCESS_TOKEN / IG_BUSINESS_ID env vars present?
//   - what is each post-stream's queue depth + last-success timestamp?
//   - how many photos / videos are sitting unused in the libraries?
//   - what do the last cron observer rows say for each posting cron?
//
// Pure read. No writes. No external API calls. Safe to invoke anytime.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const POSTING_CRONS = [
  "instagram-publish",
  "instagram-publish-reel",
  "instagram-stories",
  "tiktok-mirror",
  "facebook-mirror",
  "blog-to-social",
  "linkedin-blog-digest",
  "linkedin-company-amplify",
  "instagram-health-check",
];

interface CronTrace {
  name: string;
  last_start_at: string | null;
  last_end_at: string | null;
  last_outcome: string | null;
  last_skip_reason: string | null;
  last_error: string | null;
  run_count_7d: number;
}

async function getCronTrace(
  sb: ReturnType<typeof createServiceClient>,
  name: string,
): Promise<CronTrace> {
  // Settings keys are `cron_start_<runId>` and `cron_end_<runId>`; the
  // value is JSON containing { name, ... }. We can't index by name on
  // an opaque JSON value cheaply — but the volume is bounded by the
  // 21-day prune so a full pull is ~1k-2k rows max.
  const { data: rows } = await sb
    .from("settings")
    .select("key, value, updated_at")
    .or(`key.like.cron_start_%,key.like.cron_end_%`)
    .gte("updated_at", new Date(Date.now() - 7 * 86400 * 1000).toISOString())
    .order("updated_at", { ascending: false })
    .limit(2000);

  type Row = { key: string; value: string; updated_at: string };
  let lastStart: Row | null = null;
  let lastEnd: Row | null = null;
  let lastOutcome: string | null = null;
  let lastSkipReason: string | null = null;
  let lastError: string | null = null;
  let runCount = 0;

  for (const r of (rows ?? []) as Row[]) {
    let parsed: any = null;
    try {
      parsed = typeof r.value === "string" ? JSON.parse(r.value) : r.value;
    } catch {
      continue;
    }
    if (parsed?.name !== name) continue;

    if (r.key.startsWith("cron_start_")) {
      runCount += 1;
      if (!lastStart) lastStart = r;
    } else if (r.key.startsWith("cron_end_")) {
      if (!lastEnd) {
        lastEnd = r;
        lastOutcome = parsed.outcome ?? null;
        if (parsed.outcome === "skipped") {
          lastSkipReason =
            parsed.detail?.reason ??
            parsed.detail?.skipped ??
            JSON.stringify(parsed.detail ?? {}).slice(0, 200);
        } else if (parsed.outcome === "error" || parsed.outcome === "exception") {
          lastError =
            parsed.detail?.message ??
            parsed.detail?.error ??
            JSON.stringify(parsed.detail ?? {}).slice(0, 300);
        }
      }
    }
  }

  return {
    name,
    last_start_at: lastStart?.updated_at ?? null,
    last_end_at: lastEnd?.updated_at ?? null,
    last_outcome: lastOutcome,
    last_skip_reason: lastSkipReason,
    last_error: lastError,
    run_count_7d: runCount,
  };
}

async function settingValue(
  sb: ReturnType<typeof createServiceClient>,
  key: string,
): Promise<string | null> {
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as string | null) ?? null;
}

async function countWhere(
  sb: ReturnType<typeof createServiceClient>,
  table: string,
  apply: (q: any) => any,
): Promise<number | null> {
  try {
    const q = sb.from(table).select("id", { count: "exact", head: true });
    const { count, error } = await apply(q);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function GET() {
  const sb = createServiceClient();

  // 1 — Global pause flag
  const cronsPaused = await settingValue(sb, "crons_paused");
  const cronsPausedReason = await settingValue(sb, "crons_paused_reason");
  const cronsPausedAt = await settingValue(sb, "crons_paused_at");

  // 2 — Env-var presence (no values, only booleans, never leak secrets)
  const envPresence = {
    IG_ACCESS_TOKEN: !!process.env.IG_ACCESS_TOKEN,
    IG_BUSINESS_ID: !!process.env.IG_BUSINESS_ID,
    META_ACCESS_TOKEN: !!process.env.META_ACCESS_TOKEN,
    FB_PAGE_ID: !!process.env.FB_PAGE_ID,
    FB_PAGE_ACCESS_TOKEN: !!process.env.FB_PAGE_ACCESS_TOKEN,
    FB_USER_ACCESS_TOKEN: !!process.env.FB_USER_ACCESS_TOKEN,
    LINKEDIN_ACCESS_TOKEN: !!process.env.LINKEDIN_ACCESS_TOKEN,
    LINKEDIN_PERSON_URN: !!process.env.LINKEDIN_PERSON_URN,
    LINKEDIN_COMPANY_URN: !!process.env.LINKEDIN_COMPANY_URN,
    TIKTOK_CLIENT_KEY: !!process.env.TIKTOK_CLIENT_KEY,
    TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: !!process.env.TELEGRAM_CHAT_ID,
  };

  // 3 — IG post queue
  const igStatusCounts: Record<string, number | null> = {};
  for (const status of ["scheduled", "draft", "published", "failed", "publishing"]) {
    igStatusCounts[status] = await countWhere(sb, "ig_posts", (q) =>
      q.eq("status", status),
    );
  }
  const { data: lastPublishedRows } = await sb
    .from("ig_posts")
    .select("id, post_type, published_at, schedule_time, status")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(5);

  const { data: nextScheduledRows } = await sb
    .from("ig_posts")
    .select("id, post_type, schedule_time, status, error")
    .eq("status", "scheduled")
    .order("schedule_time", { ascending: true })
    .limit(5);

  const { data: latestDrafts } = await sb
    .from("ig_posts")
    .select("id, post_type, error, schedule_time, updated_at")
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(5);

  // 4 — Library depth
  const photosUnused = await countWhere(sb, "ig_photos", (q) =>
    q.is("used_in_post_id", null),
  );
  const photosTotal = await countWhere(sb, "ig_photos", (q) => q);
  // Videos live in the settings KV with `video_<id>` keys — count the unused.
  const { data: videoRows } = await sb
    .from("settings")
    .select("value")
    .like("key", "video_%")
    .limit(500);
  let videosUnused = 0;
  let videosTotal = 0;
  for (const r of videoRows ?? []) {
    videosTotal += 1;
    try {
      const v = JSON.parse(r.value as string);
      if (!v.used_in_post_id) videosUnused += 1;
    } catch {
      /* ignore */
    }
  }

  // 5 — Per-cron trace from cron_observer
  const traces: CronTrace[] = [];
  for (const c of POSTING_CRONS) traces.push(await getCronTrace(sb, c));

  // 6 — Quick verdict heuristic
  const verdict: string[] = [];
  if (cronsPaused === "true") {
    verdict.push(
      `🔴 GLOBAL PAUSE — crons_paused=true (reason: ${cronsPausedReason ?? "unknown"}, at: ${cronsPausedAt ?? "unknown"}). Every posting cron exits with skipped:rate_limit until this is cleared.`,
    );
  }
  if (!envPresence.IG_ACCESS_TOKEN || !envPresence.IG_BUSINESS_ID) {
    verdict.push(
      `🔴 IG ENV MISSING — IG_ACCESS_TOKEN=${envPresence.IG_ACCESS_TOKEN}, IG_BUSINESS_ID=${envPresence.IG_BUSINESS_ID}. instagram-publish exits early with "IG not configured".`,
    );
  }
  if ((igStatusCounts.scheduled ?? 0) === 0) {
    verdict.push(
      `🟡 IG POST QUEUE EMPTY — no rows in ig_posts with status='scheduled'. Even if the cron is healthy, there's nothing to publish.`,
    );
  }
  if ((photosUnused ?? 0) === 0 && (photosTotal ?? 0) > 0) {
    verdict.push(
      `🟡 PHOTO LIBRARY DEPLETED — every ig_photos row has used_in_post_id set. Run scripts/sync-ig-photos.js or upload new photos via /dashboard/instagram.`,
    );
  }

  for (const t of traces) {
    if (t.run_count_7d > 0 && t.last_outcome === "skipped") {
      verdict.push(
        `🟡 ${t.name} skipping (last reason: ${t.last_skip_reason ?? "unspecified"}). It's running but bailing.`,
      );
    }
    if (t.run_count_7d === 0) {
      verdict.push(
        `🟡 ${t.name} hasn't logged a single run in 7 days. Either the cron isn't scheduled, the wrapper isn't engaged, or every run timed out.`,
      );
    }
  }
  if (verdict.length === 0) {
    verdict.push(
      `✅ No obvious global blocker. Inspect the per-cron traces and last-published timestamps.`,
    );
  }

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    verdict,
    global: {
      crons_paused: cronsPaused,
      crons_paused_reason: cronsPausedReason,
      crons_paused_at: cronsPausedAt,
    },
    env_presence: envPresence,
    instagram: {
      status_counts: igStatusCounts,
      last_published: lastPublishedRows ?? [],
      next_scheduled: nextScheduledRows ?? [],
      latest_drafts: latestDrafts ?? [],
      photos: { unused: photosUnused, total: photosTotal },
      videos: { unused: videosUnused, total: videosTotal },
    },
    cron_traces: traces,
  });
}
