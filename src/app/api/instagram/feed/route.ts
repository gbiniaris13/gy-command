// @ts-nocheck
import { NextResponse } from "next/server";

// GET — fetch recent published posts from Instagram API
export async function GET() {
  const token = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;

  if (!token || !igId) {
    return NextResponse.json({ posts: [], error: "IG not configured" });
  }

  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count&limit=10&access_token=${encodeURIComponent(token)}`,
      { next: { revalidate: 300 } }
    );

    if (!res.ok) {
      return NextResponse.json({ posts: [], error: `IG ${res.status}` });
    }

    const data = await res.json();
    return NextResponse.json({ posts: data.data ?? [] });
  } catch {
    return NextResponse.json({ posts: [], error: "IG fetch error" });
  }
}
