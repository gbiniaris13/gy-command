// @ts-nocheck
//
// One-shot ADMIN endpoint — publish a specific scheduled post to
// Instagram NOW, bypassing the window guard, daily-limit guard, and
// stealth-skip-day. Keeps Meta-side rate-limit (the only guard that
// reflects the actual Meta cap, not our internal one) and the brand
// quality guards (caption length, banned hashtags, stock-photo host).
//
// 2026-05-07 — built in response to Boss directive: "Today's slot
// got eaten by a Hydra scenery post. I'll delete the Hydra post
// manually on IG; push the Forbes Forbes-feature post NOW for one
// time only — make an exception."
//
// Usage:
//   POST /api/admin/instagram-publish-now
//   Body: { "post_id": "fa86c4d9-..." }
//
// Returns ig_media_id on success, or the Meta error message on
// failure. The post is updated to status="published" + ig_media_id +
// published_at on success, status="failed" on failure.
//
// SAFETY: this endpoint genuinely bypasses Meta-bot-detection
// safeguards. Use sparingly. Do NOT call it programmatically — only
// for hand-curated emergencies (Forbes-launch day kind of thing).

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import {
  checkRateLimitHealth,
  logRateLimitAction,
} from "@/lib/rate-limit-guard";
import { stripBannedHashtags } from "@/lib/hashtag-guard";
import { markHashtagsUsed, clearMetaError } from "@/lib/meta-stealth";
import { getIgTokenOptional, getIgGraphRoot, getIgMediaUrl } from "@/lib/ig-token";

export const runtime = "nodejs";
export const maxDuration = 300;

const LIBRARY_HOST =
  "lquxemsonehfltdzdbhq.supabase.co/storage/v1/object/public/ig-photos";
const STOCK_HOST_PATTERNS =
  /(images\.unsplash\.com|images\.pexels\.com|pixabay\.com|shutterstock\.com|gettyimages\.com|istockphoto\.com)/i;

function captionQualityIssue(caption: string): string | null {
  const clean = (caption ?? "").trim();
  if (clean.length === 0) return "empty caption";
  if (clean.length < 100)
    return `caption too short (${clean.length} chars, need ≥100)`;
  const prose = clean.replace(/#\w+/g, "").trim();
  const wordCount = prose.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < 25)
    return `not enough prose (${wordCount} words after stripping hashtags)`;
  const anchors =
    /yacht|charter|greek|greece|aegean|ionian|cycl|hydra|mykonos|santorini|crew|sea|island|athens|broker|forbes/i;
  if (!anchors.test(prose)) return "no brand anchor keyword found";
  if (/lorem ipsum|TODO|TBD|placeholder/i.test(prose))
    return "contains placeholder text";
  return null;
}

export async function POST(req: NextRequest) {
  let body: { post_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const postId = body.post_id?.trim();
  if (!postId) {
    return NextResponse.json({ error: "post_id required" }, { status: 400 });
  }

  const igToken = getIgTokenOptional();
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return NextResponse.json(
      { error: "IG not configured (token or IG_BUSINESS_ID missing)" },
      { status: 500 },
    );
  }

  const sb = createServiceClient();
  const { data: post, error: fetchErr } = await sb
    .from("ig_posts")
    .select("*")
    .eq("id", postId)
    .maybeSingle();
  if (fetchErr || !post) {
    return NextResponse.json(
      { error: "post not found", detail: fetchErr?.message },
      { status: 404 },
    );
  }

  if (post.status === "published") {
    return NextResponse.json(
      { error: `post already published (ig_media_id ${post.ig_media_id})` },
      { status: 409 },
    );
  }

  // Caption quality + Meta rate-limit + image-source guards still
  // apply. These reflect actual Meta-side risk, not our internal
  // bot-detection cadence.
  const qualityIssue = captionQualityIssue(post.caption ?? "");
  if (qualityIssue) {
    return NextResponse.json(
      { error: `quality_guard: ${qualityIssue}` },
      { status: 422 },
    );
  }

  let blockedHost = false;
  try {
    const u = new URL(post.image_url ?? "");
    blockedHost = STOCK_HOST_PATTERNS.test(u.hostname);
  } catch {
    blockedHost = false;
  }
  if (blockedHost) {
    return NextResponse.json(
      { error: "stock_photo_guard: image host on deny list" },
      { status: 422 },
    );
  }

  if (!(await checkRateLimitHealth("post_publish"))) {
    return NextResponse.json(
      { error: "Meta rate-limit health is RED — publish refused" },
      { status: 429 },
    );
  }

  // Strip banned hashtags from caption (Meta shadowban list).
  let caption = post.caption ?? "";
  {
    const { cleaned, stripped } = await stripBannedHashtags(caption);
    if (stripped.length > 0) {
      caption = cleaned;
    }
  }

  // Mark publishing
  await sb.from("ig_posts").update({ status: "publishing" }).eq("id", postId);

  try {
    const igRoot = getIgGraphRoot();

    // Step 1 — create media container
    const containerRes = await fetch(`${igRoot}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: post.image_url,
        caption,
        access_token: igToken,
      }),
    });
    const containerData = await containerRes.json();
    if (!containerData.id) {
      throw new Error(containerData.error?.message || "container failed");
    }

    // Step 2 — wait for container ready
    let ready = false;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await fetch(
        `${getIgMediaUrl(containerData.id)}?fields=status_code&access_token=${encodeURIComponent(
          igToken,
        )}`,
      );
      const statusData = await statusRes.json();
      if (statusData.status_code === "FINISHED") {
        ready = true;
        break;
      }
      if (statusData.status_code === "ERROR") {
        throw new Error(`container processing failed: ${statusData.status_code}`);
      }
    }
    if (!ready) throw new Error("container processing timed out after 36s");

    // Step 3 — publish
    const publishRes = await fetch(`${igRoot}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: igToken,
      }),
    });
    const publishData = await publishRes.json();
    if (!publishData.id) {
      throw new Error(publishData.error?.message || "publish failed");
    }

    await sb
      .from("ig_posts")
      .update({
        status: "published",
        caption,
        ig_media_id: publishData.id,
        published_at: new Date().toISOString(),
      })
      .eq("id", postId);

    await logRateLimitAction("post_publish", {
      post_id: postId,
      ig_media_id: publishData.id,
      route: "admin-publish-now",
    });
    await markHashtagsUsed(caption);
    await clearMetaError("instagram-publish");
    await sendTelegram(
      `🚀 <b>IG admin-publish-now succeeded</b>\nPost: <code>${postId.slice(0, 8)}</code>\nIG media: ${publishData.id}\nCaption: "${caption.slice(0, 80)}..."`,
    ).catch(() => {});

    return NextResponse.json({
      ok: true,
      post_id: postId,
      ig_media_id: publishData.id,
      caption_length: caption.length,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await sb
      .from("ig_posts")
      .update({ status: "failed", error: errMsg })
      .eq("id", postId);
    await sendTelegram(
      `❌ <b>IG admin-publish-now FAILED</b>\nPost: <code>${postId.slice(0, 8)}</code>\nError: ${errMsg.slice(0, 200)}`,
    ).catch(() => {});
    return NextResponse.json(
      { error: errMsg, post_id: postId },
      { status: 500 },
    );
  }
}
