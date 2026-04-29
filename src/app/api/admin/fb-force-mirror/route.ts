// One-shot: force-mirror a specific ig_posts row to Facebook,
// regardless of facebook_status / age / post_type filters that the
// daily cron applies. Useful when the daily cron skipped a row and
// you want to backfill.
//
// Usage: GET /api/admin/fb-force-mirror?id=<ig_posts.id>
//        GET /api/admin/fb-force-mirror?dump=1&id=<id>  (read-only inspect)

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  publishPhoto,
  publishPhotoCarousel,
  publishVideo,
} from "@/lib/facebook-client";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "?id required" }, { status: 400 });
  }
  const dumpOnly = req.nextUrl.searchParams.get("dump") === "1";

  const sb = createServiceClient();
  const { data: row, error: selErr } = await sb
    .from("ig_posts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "row not found" }, { status: 404 });
  }

  if (dumpOnly) {
    return NextResponse.json({
      ok: true,
      row: {
        id: row.id,
        status: row.status,
        post_type: row.post_type,
        published_at: row.published_at,
        facebook_status: row.facebook_status,
        facebook_post_id: row.facebook_post_id,
        facebook_error: row.facebook_error,
        image_url: (row.image_url ?? "").slice(0, 200),
        caption_preview: (row.caption ?? "").slice(0, 200),
      },
    });
  }

  if (row.status !== "published") {
    return NextResponse.json(
      { error: `row status is ${row.status}, not published` },
      { status: 400 },
    );
  }
  if (!row.image_url) {
    return NextResponse.json(
      { error: "row has no image_url to mirror" },
      { status: 400 },
    );
  }

  const caption = (row.caption ?? "").trim();
  let publishRes: any;
  if (row.post_type === "reel") {
    publishRes = await publishVideo({ videoUrl: row.image_url, caption });
  } else if (row.post_type === "fleet_yacht") {
    const photos: string[] = Array.isArray(row?.metadata?.photos)
      ? row.metadata.photos
      : [row.image_url].filter(Boolean);
    publishRes =
      photos.length > 1
        ? await publishPhotoCarousel({ photoUrls: photos, caption })
        : await publishPhoto({ photoUrl: photos[0], caption });
  } else {
    publishRes = await publishPhoto({ photoUrl: row.image_url, caption });
  }

  if (!publishRes.ok) {
    await sb
      .from("ig_posts")
      .update({
        facebook_status: "failed",
        facebook_error: publishRes.error ?? "unknown",
      })
      .eq("id", id);
    return NextResponse.json({
      ok: false,
      published: false,
      error: publishRes.error,
    });
  }

  await sb
    .from("ig_posts")
    .update({
      facebook_status: "published",
      facebook_post_id: publishRes.post_id,
      facebook_error: null,
    })
    .eq("id", id);

  return NextResponse.json({
    ok: true,
    published: true,
    facebook_post_id: publishRes.post_id,
  });
}
