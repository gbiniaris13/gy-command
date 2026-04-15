// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// GET — return the latest ig_post_analytics rows (last 7 days) for the
// Post Performance section on the Instagram dashboard page.
export async function GET() {
  const sb = createServiceClient();

  const { data, error } = await sb
    .from("ig_post_analytics")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(25);

  if (error) {
    return NextResponse.json(
      { posts: [], error: error.message },
      { status: 500 }
    );
  }

  const posts = (data ?? []).map((p) => ({
    media_id: p.media_id,
    permalink: p.permalink,
    caption: p.caption,
    media_type: p.media_type,
    thumbnail_url: p.thumbnail_url,
    media_url: p.media_url,
    published_at: p.published_at,
    fetched_at: p.fetched_at,
    reach: p.reach ?? 0,
    likes: p.likes ?? 0,
    comments: p.comments ?? 0,
    saves: p.saves ?? 0,
    shares: p.shares ?? 0,
    profile_visits: p.profile_visits ?? 0,
    total_interactions: p.total_interactions ?? 0,
  }));

  return NextResponse.json({ posts });
}
