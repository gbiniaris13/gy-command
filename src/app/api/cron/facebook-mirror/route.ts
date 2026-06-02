// Facebook Page mirror cron.
//
// Same principle as tiktok-mirror: pulls freshly-published ig_posts and
// re-publishes the same asset to the corporate FB Page. Scheduled 15
// minutes after the TikTok mirror (19:30 Athens) so IG → TT → FB lands
// in a natural rhythm without tripping spam filters.
//
// No Telegram re-approval: if the caption cleared the IG gate, it's
// cleared for FB. Caption adaptation is lighter than TikTok's — we just
// drop IG-handle mentions and the carousel-only call to action.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { observeCron } from "@/lib/cron-observer";
import { sendTelegram } from "@/lib/telegram";
import {
  publishPhoto,
  publishPhotoCarousel,
  publishVideo,
} from "@/lib/facebook-client";
import { humanWindowJitterMs } from "@/lib/meta-stealth";

export const runtime = "nodejs";
export const maxDuration = 300;

function adaptCaptionForFacebook(igCaption: string): string {
  let out = igCaption;
  // Drop "Link in bio" — FB Page posts can just link directly.
  out = out.replace(/link in bio\.?/gi, "→ georgeyachts.com");
  // Trim the giant hashtag ladder common on IG — FB Page audiences
  // tune out after 4-5 tags.
  out = out.replace(/(#\w+\s*){6,}/g, (m) => {
    const tags = m.trim().split(/\s+/).slice(0, 5);
    return tags.join(" ");
  });
  // FB post body limit is 63k chars so no slicing needed, but trim
  // trailing whitespace.
  return out.trim();
}

async function _impl(req?: Request) {
  // Stealth — small randomization (0-8 min) so the FB mirror doesn't
  // fire at exactly cron+0:00 every day. Combined with the 30-min
  // separation from the IG publish, we look like a person sharing
  // their IG post to FB at a natural moment, not a bot at fixed
  // offset. Only applied when invoked by the Vercel cron (with
  // x-vercel-cron header); manual / admin invocations skip jitter.
  if (req?.headers?.get?.("x-vercel-cron")) {
    await new Promise((r) => setTimeout(r, humanWindowJitterMs(8)));
  }

  // No window guard here — the FB mirror only picks up rows that
  // already published to IG, which means IG's own window guard has
  // already cleared them. Safe by construction.
  const sb = createServiceClient();
  const url = (() => {
    try {
      return req?.url ? new URL(req.url) : null;
    } catch {
      return null;
    }
  })();
  // Default 3h window so the daily cron only mirrors the freshly-published
  // post. Pass ?hours=48 (or any int) to widen the window — useful for
  // backfilling a missed mirror.
  const sinceHours = parseInt(url?.searchParams.get("hours") ?? "3", 10);
  const since = new Date(
    Date.now() - sinceHours * 60 * 60 * 1000,
  ).toISOString();
  const { data: candidates } = await sb
    .from("ig_posts")
    .select("*")
    .eq("status", "published")
    // 2026-05-14 — added 'carousel'. Boss directive: "δε θέλω να
    // ξαναδώ τίποτα να μην πάει στο Facebook". Carousels are the
    // highest-engagement IG format and were silently dropped.
    .in("post_type", ["reel", "fleet_yacht", "image", "carousel"])
    .is("facebook_status", null)
    .gte("published_at", since)
    .limit(2);

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ skipped: "no_candidates" });
  }

  const results: any[] = [];
  for (const row of candidates) {
    const caption = adaptCaptionForFacebook(row.caption ?? "");
    let publishRes: any;
    if (row.post_type === "reel") {
      publishRes = await publishVideo({
        videoUrl: row.image_url,
        caption,
      });
    } else if (row.post_type === "fleet_yacht") {
      const photos: string[] = Array.isArray(row?.metadata?.photos)
        ? row.metadata.photos
        : [row.image_url].filter(Boolean);
      publishRes =
        photos.length > 1
          ? await publishPhotoCarousel({ photoUrls: photos, caption })
          : await publishPhoto({ photoUrl: photos[0], caption });
    } else {
      publishRes = await publishPhoto({
        photoUrl: row.image_url,
        caption,
      });
    }

    if (!publishRes.ok) {
      await sb
        .from("ig_posts")
        .update({
          facebook_status: "failed",
          facebook_error: publishRes.error ?? "unknown",
        })
        .eq("id", row.id);
      await sendTelegram(
        `⚠️ Facebook mirror failed for post ${row.id.slice(0, 8)}: ${publishRes.error}`
      ).catch(() => {});
      results.push({ id: row.id, ok: false, error: publishRes.error });
      continue;
    }

    await sb
      .from("ig_posts")
      .update({
        facebook_status: "published",
        facebook_post_id: publishRes.post_id,
      })
      .eq("id", row.id);

    await sendTelegram(
      `📘 <b>Facebook mirror OK</b>\nPost: ${row.id.slice(0, 8)}\nFB post: ${publishRes.post_id}`
    ).catch(() => {});

    results.push({ id: row.id, ok: true, post_id: publishRes.post_id });
  }

  return NextResponse.json({ mirrored: results.length, results });
}

async function _observedImpl(req?: Request) {
  // Dormant until a Facebook Page token is configured. The FB Graph
  // host only authenticates a Page / System-User token
  // (FB_PAGE_ACCESS_TOKEN). The IG_ACCESS_TOKEN fallback is an
  // Instagram-Login token (IGAA…) that graph.facebook.com rejects with
  // code 190 — so without the Page token every candidate fails and
  // spams Telegram. Skip cleanly instead; auto-activates the moment
  // FB_PAGE_ACCESS_TOKEN is set in Vercel env (no code change needed).
  if (!(process.env.FB_PAGE_ACCESS_TOKEN || "").trim()) {
    return NextResponse.json({ skipped: "fb_no_page_token" });
  }
  try {
    return await _impl(req);
  } catch (e: any) {
    await sendTelegram(
      `⚠️ <b>Facebook mirror crashed</b>\n<code>${(e?.message ?? "unknown").slice(0, 400)}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return observeCron("facebook-mirror", () => _observedImpl(req));
}
