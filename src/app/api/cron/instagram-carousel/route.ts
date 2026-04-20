// @ts-nocheck
import { NextResponse } from "next/server";

// Carousel create+process+publish can take 60-90s with our 3s poll
// loop × 12. Raise Vercel's function timeout so jitter + processing
// don't trip the default 60s limit.
export const maxDuration = 300;

import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { sendTelegram } from "@/lib/telegram";
import {
  applyPublishJitter,
  checkRateLimitHealth,
  logRateLimitAction,
} from "@/lib/rate-limit-guard";
import { stripBannedHashtags } from "@/lib/hashtag-guard";
import { isCaptionTooSimilar } from "@/lib/caption-similarity";

// Cron: Wednesday 14:00 UTC (17:00 Athens) — weekly carousel post.
// Carousels get 3x more reach than single images on Instagram.
// Uses 5 photos from ROBERTO IG library + AI-generated caption.

const CAROUSEL_TOPICS = [
  "Top 5 Greek islands for first-time charterers",
  "5 things your captain wishes you knew before boarding",
  "A week in the Cyclades: day by day",
  "5 hidden beaches only accessible by yacht",
  "The 5 best sunset anchorages in Greece",
  "What's included in a crewed charter (slide by slide)",
  "5 reasons the Ionian beats the Riviera",
  "Morning to night: 24 hours on a luxury yacht",
  "5 Greek islands that aren't Mykonos or Santorini",
  "The APA explained in 5 slides",
  "5 reasons to charter in September (shoulder season secrets)",
  "Greek yacht cuisine: 5 dishes your chef will prepare",
];

export async function GET() {
  const igToken = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return NextResponse.json({ error: "IG not configured" });
  }

  // Phase A — rate-limit breaker + jitter. Carousels count as feed posts
  // for Meta's cap so we share the post_publish action bucket.
  if (!(await checkRateLimitHealth("post_publish"))) {
    return NextResponse.json({ skipped: "rate_limit" });
  }
  await applyPublishJitter();

  const sb = createServiceClient();

  // Pick topic based on week number
  const weekNum = Math.floor((Date.now() - new Date("2026-01-01").getTime()) / (7 * 86400000));
  const topic = CAROUSEL_TOPICS[weekNum % CAROUSEL_TOPICS.length];

  // Get 5 unused photos (different from each other)
  const { data: photos } = await sb
    .from("ig_photos")
    .select("id, public_url, description")
    .is("used_in_post_id", null)
    .order("uploaded_at", { ascending: false })
    .limit(20);

  if (!photos || photos.length < 5) {
    await sendTelegram(`⚠️ Need 5+ unused photos for carousel. Only ${photos?.length || 0} available.`);
    return NextResponse.json({ error: "not enough photos" });
  }

  // Pick 5 random (spread them out)
  const shuffled = [...photos].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 5);

  // Generate caption
  let caption = "";
  try {
    const raw = await aiChat(
      "You write Instagram captions as George Yachts (brand voice, NOT personal). Use 'we' not 'I'. Never claim personal experience. Return only the caption text.",
      `Write a carousel post caption for: "${topic}"

Rules:
- Hook first line (question or bold statement)
- Tell readers to swipe through the 5 slides
- 150-250 words
- End with CTA (link in bio / DM us)
- George Yachts voice: warm, authoritative, insider
- Include 15 hashtags at the end (mix geo + niche + volume)`
    );
    caption = raw.replace(/^["']|["']$/g, "").trim();
  } catch {
    caption = `${topic}\n\nSwipe through to discover more. Every detail matters when you're planning the perfect Greek island charter.\n\nFree consultation → link in bio\n\n#yachtcharter #greekislands #greece #luxurytravel #charterlife #georgeyachts`;
  }

  // Phase A — banned hashtag guard on the AI-generated caption.
  {
    const { cleaned, stripped } = await stripBannedHashtags(caption);
    if (stripped.length > 0) {
      await sendTelegram(
        `⚠ Stripped banned hashtags from carousel: ${stripped.join(" ")}`,
      );
      caption = cleaned;
    }
  }

  // Phase B — caption similarity check (fail-open, alert only).
  {
    const sim = await isCaptionTooSimilar(caption);
    if (sim.similar) {
      await sendTelegram(
        `⚠ <b>Carousel caption similarity flag</b>\nReason: ${sim.reason ?? "n/a"}\nMatched: "${sim.matchedCaptionPreview ?? ""}..."\n\nPublishing anyway.`,
      );
    }
  }

  try {
    // Step 1: Create individual media containers for each slide
    const childIds = [];
    for (const photo of selected) {
      const res = await fetch(`https://graph.instagram.com/v21.0/${igId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: photo.public_url,
          is_carousel_item: true,
          access_token: igToken,
        }),
      });
      const data = await res.json();
      if (data.id) childIds.push(data.id);
      await new Promise(r => setTimeout(r, 1000));
    }

    if (childIds.length < 2) {
      return NextResponse.json({ error: "Could not create enough carousel items" });
    }

    // Step 2: Create carousel container
    const carouselRes = await fetch(`https://graph.instagram.com/v21.0/${igId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "CAROUSEL",
        children: childIds,
        caption,
        access_token: igToken,
      }),
    });
    const carouselData = await carouselRes.json();

    if (!carouselData.id) {
      return NextResponse.json({ error: carouselData.error?.message || "carousel container failed" });
    }

    // Step 3: Wait for processing
    let ready = false;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(
        `https://graph.instagram.com/v21.0/${carouselData.id}?fields=status_code&access_token=${encodeURIComponent(igToken)}`
      );
      const statusData = await statusRes.json();
      if (statusData.status_code === "FINISHED") { ready = true; break; }
      if (statusData.status_code === "ERROR") break;
    }

    if (!ready) {
      return NextResponse.json({ error: "Carousel processing timeout" });
    }

    // Step 4: Publish
    const publishRes = await fetch(`https://graph.instagram.com/v21.0/${igId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: carouselData.id,
        access_token: igToken,
      }),
    });
    const publishData = await publishRes.json();

    if (publishData.id) {
      // Mark photos as used
      for (const photo of selected) {
        await sb.from("ig_photos").update({ used_in_post_id: publishData.id }).eq("id", photo.id);
      }

      // Log in ig_posts
      await sb.from("ig_posts").insert({
        image_url: selected[0].public_url,
        caption,
        status: "published",
        ig_media_id: publishData.id,
        published_at: new Date().toISOString(),
        schedule_time: new Date().toISOString(),
      });

      await logRateLimitAction("post_publish", {
        media_id: publishData.id,
        kind: "carousel",
      });
      await sendTelegram(
        `🎠 <b>Carousel published!</b>\n\nTopic: ${topic}\n${childIds.length} slides\n\nCaption preview: "${caption.slice(0, 100)}..."`
      );

      return NextResponse.json({ ok: true, media_id: publishData.id, slides: childIds.length, topic });
    }

    return NextResponse.json({ error: publishData.error?.message || "publish failed" });
  } catch (err) {
    return NextResponse.json({ error: err.message });
  }
}
