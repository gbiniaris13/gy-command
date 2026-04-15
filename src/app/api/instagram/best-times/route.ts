// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// GET /api/instagram/best-times
//
// Uses the rows we already collect in ig_post_analytics (filled by the
// /api/cron/instagram-analytics cron) to compute the strongest day-of-
// week / hour-of-day slots for engagement. We do this client-side rather
// than relying on the Instagram `online_followers` insights metric, which
// has been deprecated in newer API versions.
//
// Algorithm:
//   1. Bucket each post by (Europe/Athens dayOfWeek, hour)
//   2. Compute engagement_rate = total_interactions / max(reach, 1)
//   3. Average engagement_rate inside each bucket
//   4. Return top buckets sorted desc, plus per-day and per-hour
//      summaries so the UI can render heatmap-style insights
//
// Sample size matters — anything below MIN_POSTS yields a notReadyYet
// flag so the UI shows a "needs more data" hint instead of pretending
// 2 posts can pick a winner.

const MIN_POSTS = 5;
const TOP_SLOTS = 5;
const TIMEZONE = "Europe/Athens";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface RawPost {
  published_at: string | null;
  reach: number | null;
  total_interactions: number | null;
}

interface Bucket {
  day: number;
  hour: number;
  posts: number;
  totalRate: number;
}

function bucketKey(day: number, hour: number) {
  return `${day}-${hour}`;
}

// Pull (dayOfWeek, hour) for an ISO timestamp in Europe/Athens. Uses
// Intl.DateTimeFormat so DST is handled correctly without a tz library.
function athensSlot(iso: string): { day: number; hour: number } {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    day: dayMap[weekdayShort] ?? 0,
    // "24" rolls back to "00" when hour12 is false — guard explicitly
    hour: Math.min(parseInt(hourStr, 10) % 24, 23),
  };
}

export async function GET() {
  const sb = createServiceClient();

  const { data, error } = await sb
    .from("ig_post_analytics")
    .select("published_at, reach, total_interactions")
    .not("published_at", "is", null);

  if (error) {
    return NextResponse.json(
      {
        slots: [],
        bestDay: null,
        bestHour: null,
        sampleSize: 0,
        notReadyYet: true,
        error: error.message,
      },
      { status: 500 }
    );
  }

  const posts: RawPost[] = data ?? [];
  const sampleSize = posts.length;

  if (sampleSize === 0) {
    return NextResponse.json({
      slots: [],
      bestDay: null,
      bestHour: null,
      perDay: [],
      perHour: [],
      sampleSize: 0,
      minPosts: MIN_POSTS,
      notReadyYet: true,
      timezone: TIMEZONE,
    });
  }

  // Aggregate
  const buckets = new Map<string, Bucket>();
  const dayTotals = new Array(7).fill(0).map(() => ({ posts: 0, totalRate: 0 }));
  const hourTotals = new Array(24).fill(0).map(() => ({ posts: 0, totalRate: 0 }));

  for (const p of posts) {
    if (!p.published_at) continue;
    const reach = Math.max(p.reach ?? 0, 1);
    const interactions = p.total_interactions ?? 0;
    const rate = interactions / reach;
    const { day, hour } = athensSlot(p.published_at);

    const key = bucketKey(day, hour);
    const existing = buckets.get(key) ?? { day, hour, posts: 0, totalRate: 0 };
    existing.posts += 1;
    existing.totalRate += rate;
    buckets.set(key, existing);

    dayTotals[day].posts += 1;
    dayTotals[day].totalRate += rate;
    hourTotals[hour].posts += 1;
    hourTotals[hour].totalRate += rate;
  }

  const slots = Array.from(buckets.values())
    .map((b) => ({
      day: b.day,
      day_name: DAY_NAMES[b.day],
      hour: b.hour,
      posts: b.posts,
      avg_engagement_rate:
        b.posts > 0 ? Math.round((b.totalRate / b.posts) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate)
    .slice(0, TOP_SLOTS);

  const perDay = dayTotals.map((d, i) => ({
    day: i,
    day_name: DAY_NAMES[i],
    posts: d.posts,
    avg_engagement_rate:
      d.posts > 0 ? Math.round((d.totalRate / d.posts) * 10000) / 100 : 0,
  }));

  const perHour = hourTotals.map((h, i) => ({
    hour: i,
    posts: h.posts,
    avg_engagement_rate:
      h.posts > 0 ? Math.round((h.totalRate / h.posts) * 10000) / 100 : 0,
  }));

  // Pick a single best day/hour by avg rate, ignoring buckets with 0 posts
  const bestDay =
    [...perDay]
      .filter((d) => d.posts > 0)
      .sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate)[0] ?? null;
  const bestHour =
    [...perHour]
      .filter((h) => h.posts > 0)
      .sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate)[0] ?? null;

  return NextResponse.json({
    slots,
    bestDay,
    bestHour,
    perDay,
    perHour,
    sampleSize,
    minPosts: MIN_POSTS,
    notReadyYet: sampleSize < MIN_POSTS,
    timezone: TIMEZONE,
  });
}
