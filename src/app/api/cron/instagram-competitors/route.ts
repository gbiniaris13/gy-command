// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// Vercel cron — daily snapshot of competitor IG accounts via the
// business_discovery endpoint. Works for any public business / creator
// account; we don't need to follow them and we don't need user OAuth.
//
// Stores one row per (date, username) so the dashboard can chart
// follower-count delta and posting cadence over time.

const COMPETITORS = [
  "charterworld",
  "burgessyachts",
  "yachtcharterfleet",
  "northropandjohnson",
  "fraseryachts",
];

interface DiscoveryMedia {
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
}

interface DiscoveryResponse {
  business_discovery?: {
    username?: string;
    followers_count?: number;
    media_count?: number;
    media?: { data?: DiscoveryMedia[] };
  };
  error?: { message?: string };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sum = nums.reduce((a, b) => a + b, 0);
  return Math.round((sum / nums.length) * 100) / 100;
}

export async function GET() {
  const token = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!token || !igId) {
    return NextResponse.json({ error: "IG not configured" }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const sb = createServiceClient();
  const results: Array<{ username: string; ok: boolean; reason?: string }> = [];

  for (const username of COMPETITORS) {
    try {
      const fields = `business_discovery.username(${username}){username,followers_count,media_count,media.limit(20){like_count,comments_count,timestamp}}`;
      const url = `https://graph.instagram.com/v21.0/${igId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { cache: "no-store" });
      const json: DiscoveryResponse = await res.json();

      if (!res.ok || !json.business_discovery) {
        results.push({
          username,
          ok: false,
          reason: json?.error?.message ?? `HTTP ${res.status}`,
        });
        continue;
      }

      const bd = json.business_discovery;
      const allMedia = bd.media?.data ?? [];
      const recentLast5 = allMedia.slice(0, 5);
      const likes = recentLast5.map((m) => m.like_count ?? 0);
      const comments = recentLast5.map((m) => m.comments_count ?? 0);

      const postsLast30 = allMedia.filter((m) => {
        if (!m.timestamp) return false;
        return new Date(m.timestamp).getTime() >= cutoff30;
      }).length;

      const row = {
        date: today,
        username: bd.username ?? username,
        followers_count: bd.followers_count ?? null,
        media_count: bd.media_count ?? null,
        posts_last_30d: postsLast30,
        avg_likes_last_5: avg(likes),
        avg_comments_last_5: avg(comments),
        recorded_at: new Date().toISOString(),
      };

      const { error } = await sb
        .from("ig_competitors")
        .upsert(row, { onConflict: "date,username" });

      if (error) {
        results.push({ username, ok: false, reason: error.message });
      } else {
        results.push({ username, ok: true });
      }
    } catch (err) {
      results.push({
        username,
        ok: false,
        reason: err instanceof Error ? err.message : "fetch failed",
      });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    ok,
    failed: failed.length,
    total: COMPETITORS.length,
    failures: failed,
  });
}
