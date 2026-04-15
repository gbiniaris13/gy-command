// @ts-nocheck
import { NextResponse } from "next/server";

// GET /api/admin/find-comment?username=eleanna_karvouni&text=stunning&limit=15
//
// Walks the most recent N media items from @georgeyachts, fetches
// comments on each, and returns any comment matching the username
// and/or text filter. Primary use: recover the comment_id so the
// cleanup endpoint can delete duplicate replies without George
// hunting through Instagram UI.
//
// Public GET — no secret needed since it's read-only and exposes only
// data already visible on a public post page.

export async function GET(request: Request) {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "IG not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const usernameFilter = (searchParams.get("username") ?? "").toLowerCase().replace(/^@/, "");
  const textFilter = (searchParams.get("text") ?? "").toLowerCase();
  const mediaLimit = Math.min(parseInt(searchParams.get("limit") ?? "15", 10) || 15, 30);

  // 1. List recent media
  let media: any[] = [];
  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/me/media?fields=id,caption,timestamp,permalink&limit=${mediaLimit}&access_token=${encodeURIComponent(token)}`
    );
    const json = await res.json();
    if (!res.ok || !Array.isArray(json?.data)) {
      return NextResponse.json(
        { error: "media list failed", detail: json?.error?.message ?? `HTTP ${res.status}` },
        { status: 502 }
      );
    }
    media = json.data;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch failed" },
      { status: 502 }
    );
  }

  // 2. For each media item, pull comments and filter
  const hits: any[] = [];
  const scanned: Array<{ media_id: string; comment_count: number; error?: string }> = [];

  for (const m of media) {
    try {
      const res = await fetch(
        `https://graph.instagram.com/v21.0/${m.id}/comments?fields=id,text,username,timestamp,replies{id,text,username,timestamp}&limit=100&access_token=${encodeURIComponent(token)}`
      );
      const json = await res.json();
      if (!res.ok || !Array.isArray(json?.data)) {
        scanned.push({
          media_id: m.id,
          comment_count: 0,
          error: json?.error?.message ?? `HTTP ${res.status}`,
        });
        continue;
      }
      const comments = json.data;
      scanned.push({ media_id: m.id, comment_count: comments.length });

      for (const c of comments) {
        const cUsername = String(c.username ?? "").toLowerCase();
        const cText = String(c.text ?? "").toLowerCase();
        const usernameMatch = !usernameFilter || cUsername === usernameFilter;
        const textMatch = !textFilter || cText.includes(textFilter);
        if (usernameMatch && textMatch) {
          hits.push({
            comment_id: c.id,
            username: c.username,
            text: c.text,
            timestamp: c.timestamp,
            media_id: m.id,
            media_permalink: m.permalink,
            media_caption_first_line: (m.caption ?? "").split("\n")[0].slice(0, 80),
            our_replies_count: Array.isArray(c.replies?.data) ? c.replies.data.length : 0,
            our_replies_preview: Array.isArray(c.replies?.data)
              ? c.replies.data.slice(0, 15).map((r: any) => ({
                  id: r.id,
                  text: (r.text ?? "").slice(0, 100),
                  username: r.username,
                  timestamp: r.timestamp,
                }))
              : [],
          });
        }
      }
    } catch (err) {
      scanned.push({
        media_id: m.id,
        comment_count: 0,
        error: err instanceof Error ? err.message : "fetch failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    username_filter: usernameFilter || null,
    text_filter: textFilter || null,
    media_scanned: scanned.length,
    hits_count: hits.length,
    hits,
    scan_summary: scanned,
  });
}
