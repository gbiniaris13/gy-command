// @ts-nocheck
// TikTok mirror cron.
//
// Pulls rows from ig_posts where:
//   status = 'published' (on Instagram)
//   post_type IN ('reel', 'fleet_yacht')   ← videos + photo carousels only
//   tiktok_status IS NULL                  ← not yet mirrored
//   published_at > NOW() - interval '3 hours'  ← only recent posts
//
// and publishes the same asset to @george.yachts on TikTok. Every
// mirrored post shares the SAME Telegram approval lineage as its IG
// sibling — if George approved the IG caption, it's approved for TT
// too. Separate caption-style adaptation (hashtag swap, opener tweak)
// runs in adaptCaptionForTikTok().
//
// Schedule: `15 16 * * 1-5` in vercel.json = 19:15 Athens, 1h after
// the IG publish window. Gives IG time to render + lets us read
// engagement signals before duplicating (future optimisation: skip
// mirror if IG post flatlined).

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { publishVideo, publishPhotos, pollPublishStatus } from "@/lib/tiktok-client";
import { assertPublishAllowed } from "@/lib/ig-window-guard";

export const runtime = "nodejs";
export const maxDuration = 300;

function adaptCaptionForTikTok(igCaption: string): string {
  // Swap IG-specific hashtags for TikTok-native equivalents. Rough
  // mapping only — the right long-term answer is an LLM call that's
  // prompted with TikTok's current trending tags. For now, a static
  // find/replace gets us 80% of the benefit.
  const swaps: Array<[RegExp, string]> = [
    [/#YachtCharterGreece/gi, "#YachtCharterGreece #GreekYachtTok"],
    [/#CycladesIslands/gi, "#CycladesIslands #GreekIslands"],
    [/#FountainePajot/gi, "#FountainePajot #Catamaran"],
    [/#LuxuryCharter\w*/gi, "#LuxuryYachtLife #YachtLife"],
    [/#MediterraneanCharter/gi, "#MediterraneanSea"],
  ];
  let out = igCaption;
  for (const [re, val] of swaps) out = out.replace(re, val);
  // Trim to TikTok's 2200 char limit.
  return out.slice(0, 2200);
}

async function _impl() {
  // Same window guard — TikTok posts stay inside brand-safe hours.
  const gate = await assertPublishAllowed({ postType: "reel" });
  if (!gate.allowed) {
    return NextResponse.json({
      skipped: "window_guard",
      reason: gate.reason,
      detail: gate.detail,
    });
  }

  const sb = createServiceClient();
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data: candidates } = await sb
    .from("ig_posts")
    .select("*")
    .eq("status", "published")
    .in("post_type", ["reel", "fleet_yacht", "image"])
    .is("tiktok_status", null)
    .gte("published_at", since)
    .limit(2);

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ skipped: "no_candidates" });
  }

  const results: any[] = [];
  for (const row of candidates) {
    const caption = adaptCaptionForTikTok(row.caption ?? "");
    let publishRes: any;
    if (row.post_type === "reel") {
      publishRes = await publishVideo({
        videoUrl: row.image_url, // the library stores video URL here for reels
        caption,
      });
    } else {
      // fleet_yacht + image → photo carousel on TikTok. For fleet we
      // have the full Sanity photo list in row.metadata.photos; fall
      // back to a single-image post if only the hero exists.
      const photos: string[] = Array.isArray(row?.metadata?.photos)
        ? row.metadata.photos
        : [row.image_url].filter(Boolean);
      publishRes = await publishPhotos({ photoUrls: photos, caption });
    }

    if (!publishRes.ok) {
      await sb
        .from("ig_posts")
        .update({
          tiktok_status: "failed",
          tiktok_error: publishRes.error ?? "unknown",
        })
        .eq("id", row.id);
      await sendTelegram(
        `⚠️ TikTok mirror failed for post ${row.id.slice(0, 8)}: ${publishRes.error}`
      ).catch(() => {});
      results.push({ id: row.id, ok: false, error: publishRes.error });
      continue;
    }

    const status = await pollPublishStatus(publishRes.publish_id!);
    await sb
      .from("ig_posts")
      .update({
        tiktok_status: status.status === "PUBLISH_COMPLETE" ? "published" : "pending",
        tiktok_publish_id: publishRes.publish_id,
      })
      .eq("id", row.id);

    await sendTelegram(
      `🎵 <b>TikTok mirror OK</b>\nPost: ${row.id.slice(0, 8)}\nStatus: ${status.status}\n@george.yachts`
    ).catch(() => {});

    results.push({ id: row.id, ok: true, status: status.status });
  }

  return NextResponse.json({ mirrored: results.length, results });
}

export async function GET() {
  // Flag-gate: until TikTok app review completes + tiktok_oauth token
  // is stored in settings, every daily invocation just burns compute
  // + risks 500s. Flip settings.tiktok_enabled=true after first OAuth
  // to activate.
  try {
    const sb = createServiceClient();
    const { data: flag } = await sb
      .from("settings")
      .select("value")
      .eq("key", "tiktok_enabled")
      .maybeSingle();
    if (flag?.value !== "true") {
      return NextResponse.json({ skipped: "tiktok_disabled_flag_off" });
    }
  } catch {
    // If settings lookup fails, fall through rather than block silently.
  }

  try {
    return await _impl();
  } catch (e: any) {
    await sendTelegram(
      `⚠️ <b>TikTok mirror crashed</b>\n<code>${(e?.message ?? "unknown").slice(0, 400)}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}
