// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// GET /api/instagram/best-times
//
// Two-tier recommendation:
//
// 1. PRIMARY — Industry-backed posting windows + the George Yachts UHNW
//    US-audience overlay. We do NOT try to derive a "best time" from
//    16 in-house posts, because that's statistical noise. Instagram's
//    own `online_followers` metric is deprecated in v22+, so we can't
//    trust it either. Instead we hard-code the 2026 industry benchmarks
//    that the brief calls out and translate them into the Europe/Athens
//    timezone the dashboard runs in.
//
// 2. SECONDARY — Once we have at least IN_HOUSE_MIN_POSTS tracked posts
//    in ig_post_analytics, we ALSO compute average engagement rate per
//    (day, hour) bucket from our own data and surface the strongest
//    real slots beside the industry recommendation. Until then, the
//    in-house section is hidden and the empty-state copy explains why.
//
// Algorithm key signals to keep in mind for downstream features:
//   • Sends per reach > likes (3-5x stronger)
//   • Watch time / completion rate > raw views
//   • Saves are 3x more important than likes
//   • Carousel posts get ~10.15% engagement vs 4-6% for single images
//   • 3-5 niche hashtags only; SEO copy in caption matters more

const TIMEZONE = "Europe/Athens";
const IN_HOUSE_MIN_POSTS = 50;
const TOP_SLOTS = 5;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// 2026 industry benchmarks (52M+ posts analyzed). day = 0..6 (Sun=0).
// Each entry is one recommended slot with an explanation that's surfaced
// to George in the dashboard tooltip.
const INDUSTRY_WINDOWS = [
  {
    day: 2, // Tue
    hour_start: 7,
    hour_end: 9,
    score: 95,
    label: "Morning commute",
    note: "Tue/Wed/Thu mornings are the highest-engagement slot industry-wide.",
  },
  {
    day: 3, // Wed
    hour_start: 7,
    hour_end: 9,
    score: 95,
    label: "Morning commute",
    note: "Tue/Wed/Thu mornings are the highest-engagement slot industry-wide.",
  },
  {
    day: 4, // Thu
    hour_start: 7,
    hour_end: 9,
    score: 92,
    label: "Morning commute",
    note: "Tue/Wed/Thu mornings are the highest-engagement slot industry-wide.",
  },
  {
    day: 2,
    hour_start: 11,
    hour_end: 13,
    score: 90,
    label: "Lunch break",
    note: "Mid-day window — high scroll volume on weekdays.",
  },
  {
    day: 3,
    hour_start: 11,
    hour_end: 13,
    score: 90,
    label: "Lunch break",
    note: "Mid-day window — high scroll volume on weekdays.",
  },
  {
    day: 4,
    hour_start: 11,
    hour_end: 13,
    score: 88,
    label: "Lunch break",
    note: "Mid-day window — high scroll volume on weekdays.",
  },
  {
    day: 2,
    hour_start: 18,
    hour_end: 21,
    score: 100,
    label: "Athens evening = US lunch ⭐",
    note:
      "Athens 18:00–19:30 = NYC 11:00–12:30 EST = lunch break for our UHNW US audience. PEAK slot for George Yachts.",
  },
  {
    day: 3,
    hour_start: 18,
    hour_end: 21,
    score: 100,
    label: "Athens evening = US lunch ⭐",
    note:
      "Athens 18:00–19:30 = NYC 11:00–12:30 EST = lunch break for our UHNW US audience. PEAK slot for George Yachts.",
  },
  {
    day: 4,
    hour_start: 18,
    hour_end: 21,
    score: 98,
    label: "Athens evening = US lunch ⭐",
    note:
      "Athens 18:00–19:30 = NYC 11:00–12:30 EST = lunch break for our UHNW US audience. PEAK slot for George Yachts.",
  },
];

const REELS_NOTE =
  "Reels: post Wed/Thu evening 18:00–21:00 (Athens). Longer Reels (90s+) now rewarded — don't cap at 15s clips.";

const ALGORITHM_TIPS = [
  "Sends per reach (DM shares) is the #1 ranking signal — 3-5× more weight than likes.",
  "Watch time / completion rate is the #2 signal — pace your Reels for full plays.",
  "Saves are 3× more important than likes — make pinnable, list-style content.",
  "Carousels get ~10.15% engagement (vs 4-6% for single images) and 55% more reach.",
  "3-5 niche hashtags only. SEO keywords in the caption matter more than tag count.",
  "Original content only — 10+ reposts in 30 days = excluded from recommendations.",
  "Consistency beats volume — 3-5 posts/week steady > 10 posts then silence.",
];

interface RawPost {
  published_at: string | null;
  reach: number | null;
  total_interactions: number | null;
}

function bucketKey(day: number, hour: number) {
  return `${day}-${hour}`;
}

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
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    day: dayMap[weekdayShort] ?? 0,
    hour: Math.min(parseInt(hourStr, 10) % 24, 23),
  };
}

export async function GET() {
  // 1. Always-on industry recommendation block
  const recommended = INDUSTRY_WINDOWS.slice()
    .sort((a, b) => b.score - a.score)
    .map((w) => ({
      ...w,
      day_name: DAY_NAMES[w.day],
    }));

  const peakSlot = recommended.find((w) =>
    w.label.includes("US lunch")
  ) ?? recommended[0];

  // 2. Optional in-house data — only when we have a meaningful sample.
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("ig_post_analytics")
    .select("published_at, reach, total_interactions")
    .not("published_at", "is", null);

  const posts: RawPost[] = !error && data ? data : [];
  const sampleSize = posts.length;

  let inHouseSlots: Array<{
    day: number;
    day_name: string;
    hour: number;
    posts: number;
    avg_engagement_rate: number;
  }> = [];

  if (sampleSize >= IN_HOUSE_MIN_POSTS) {
    const buckets = new Map<
      string,
      { day: number; hour: number; posts: number; totalRate: number }
    >();
    for (const p of posts) {
      if (!p.published_at) continue;
      const reach = Math.max(p.reach ?? 0, 1);
      const interactions = p.total_interactions ?? 0;
      const rate = interactions / reach;
      const { day, hour } = athensSlot(p.published_at);
      const key = bucketKey(day, hour);
      const existing =
        buckets.get(key) ?? { day, hour, posts: 0, totalRate: 0 };
      existing.posts += 1;
      existing.totalRate += rate;
      buckets.set(key, existing);
    }
    inHouseSlots = Array.from(buckets.values())
      .map((b) => ({
        day: b.day,
        day_name: DAY_NAMES[b.day],
        hour: b.hour,
        posts: b.posts,
        avg_engagement_rate:
          b.posts > 0
            ? Math.round((b.totalRate / b.posts) * 10000) / 100
            : 0,
      }))
      .sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate)
      .slice(0, TOP_SLOTS);
  }

  return NextResponse.json({
    timezone: TIMEZONE,
    peakSlot,
    recommended,
    reelsNote: REELS_NOTE,
    algorithmTips: ALGORITHM_TIPS,
    inHouse: {
      enabled: sampleSize >= IN_HOUSE_MIN_POSTS,
      sampleSize,
      minPosts: IN_HOUSE_MIN_POSTS,
      slots: inHouseSlots,
    },
  });
}
