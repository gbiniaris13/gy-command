// @ts-nocheck
import { NextResponse } from "next/server";

// Reels take the longest to process on IG's side (up to 100s). Raise
// Vercel's function timeout to cover jitter + polling + publish.
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

// Cron: publishes 1 Instagram Reel per firing, picking an unused video
// from the library + generating a fresh caption.
//
// Roberto brief v3, Phase C. Feature-flag-gated so this cron is a no-op
// until George flips settings.reels_enabled = "true" via the dashboard
// (or via a one-liner upsert). The flag defaults to disabled so merging
// this code DOES NOT start posting reels — we wait for George's green
// light once at least 5-10 videos are uploaded.
//
// Library:
//   - Videos are stored as `settings` rows with key LIKE 'video_%' and
//     a JSON value including { id, public_url, used_in_post_id, ... }.
//     See /api/instagram/videos/upload.
//   - A published reel's video gets `used_in_post_id` stamped so it's
//     never reused in another reel (same semantic as photos in feed).
//
// Schedule slot is NOT wired into vercel.json yet — that happens in
// the Phase C rollout once `reels_enabled = "true"`. For now, manual
// trigger via GET to the endpoint is the only way to fire this.

const REEL_ANGLES = [
  "a quiet on-deck moment as the yacht gets underway",
  "an aerial reveal of a Greek island anchorage",
  "a sunset cruise detail — crew, deck, horizon",
  "morning on the foredeck, coffee in hand",
  "the tender peeling away toward a hidden cove",
  "swim platform golden-hour shot",
  "an interior transition — salon to aft deck",
  "a waterline view drifting past a cliff-side village",
];

const FLAG_KEY = "reels_enabled";

export async function GET() {
  const igToken = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return NextResponse.json({ error: "IG not configured" });
  }

  const sb = createServiceClient();

  // Phase C feature flag — exit silently until George enables it.
  const { data: flagRow } = await sb
    .from("settings")
    .select("value")
    .eq("key", FLAG_KEY)
    .maybeSingle();
  if (flagRow?.value !== "true") {
    return NextResponse.json({ skipped: "reels_disabled" });
  }

  // Phase A rate-limit guard + jitter. Reels count against the feed
  // post cap on IG.
  if (!(await checkRateLimitHealth("post_publish"))) {
    return NextResponse.json({ skipped: "rate_limit" });
  }
  await applyPublishJitter();

  // Pull unused videos. Settings rows are pulled in bulk; we parse JSON
  // and filter in memory — the library is expected to be a few hundred
  // rows max, so this is cheap.
  const { data: rows } = await sb
    .from("settings")
    .select("key, value, updated_at")
    .like("key", "video_%")
    .order("updated_at", { ascending: false })
    .limit(500);

  const unused = (rows ?? [])
    .map((row) => {
      try {
        return JSON.parse(row.value);
      } catch {
        return null;
      }
    })
    .filter((v) => v && !v.used_in_post_id);

  if (unused.length === 0) {
    await sendTelegram(
      "⚠️ No unused videos for Reels. Drop new clips in ~/Desktop/ROBERTO IG videos/ and run `node scripts/sync-ig-videos.js`.",
    );
    return NextResponse.json({ error: "no videos" });
  }

  // Pick one — least recently uploaded first (LRU, newest last), so we
  // burn through older stock before new uploads.
  unused.sort((a, b) => String(a.uploaded_at).localeCompare(String(b.uploaded_at)));
  const video = unused[0];

  // Generate caption in brand voice.
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
  );
  const angle = REEL_ANGLES[dayOfYear % REEL_ANGLES.length];
  let caption = "";
  try {
    const raw = await aiChat(
      "You write Instagram Reel captions as George Yachts (brand voice, NOT personal). Use 'we' not 'I'. Never claim personal experience. Return only the caption text.",
      `Write a luxury yacht charter Reel caption matching this clip angle: "${angle}".

Rules:
- Hook first line (evocative, 5-9 words)
- 80-150 words prose
- 1 clear question to drive comments
- End with CTA: "DM us" or "link in bio"
- Include 12-18 hashtags at the end (mix: #yachtcharter, geo, niche)
- George Yachts voice: warm, insider, authoritative, never salesy
- NEVER use "I" / "my" / years of experience`,
    );
    caption = raw.replace(/^["']|["']$/g, "").trim();
  } catch {
    caption = `Quiet morning on deck. The engine hums, coffee cools, and the Aegean opens ahead.\n\nA week on a private yacht isn't just travel — it's the difference between seeing Greece and living it.\n\nWhich island would you start with?\n\nDM us to plan yours → link in bio\n\n#yachtcharter #greekislands #greece #luxurytravel #aegean #cyclades #charterlife #georgeyachts #yachtlife #mediterranean #summer2026 #privatecharter`;
  }

  // Phase A banned hashtag guard.
  {
    const { cleaned, stripped } = await stripBannedHashtags(caption);
    if (stripped.length > 0) {
      caption = cleaned;
      await sendTelegram(
        `⚠ Stripped banned hashtags from reel: ${stripped.join(" ")}`,
      );
    }
  }

  // Phase B caption similarity (fail-open).
  {
    const sim = await isCaptionTooSimilar(caption);
    if (sim.similar) {
      await sendTelegram(
        `⚠ Reel caption similarity flag — ${sim.reason ?? "n/a"}`,
      );
    }
  }

  try {
    // Step 1 — Create REELS container
    const createRes = await fetch(`https://graph.instagram.com/v21.0/me/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        video_url: video.public_url,
        caption,
        access_token: igToken,
      }),
    });
    const createData = await createRes.json();
    if (!createData.id) {
      const err = createData.error?.message || "container failed";
      await sendTelegram(`❌ Reel creation failed: ${err}`);
      return NextResponse.json({ error: err });
    }

    // Step 2 — Wait for processing (reels take longer than photos).
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const statusRes = await fetch(
        `https://graph.instagram.com/v21.0/${createData.id}?fields=status_code&access_token=${encodeURIComponent(igToken)}`,
      );
      const statusData = await statusRes.json();
      if (statusData.status_code === "FINISHED") {
        ready = true;
        break;
      }
      if (statusData.status_code === "ERROR") break;
    }
    if (!ready) {
      return NextResponse.json({ error: "Reel processing timeout (100s)" });
    }

    // Step 3 — Publish
    const publishRes = await fetch(
      `https://graph.instagram.com/v21.0/me/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: createData.id,
          access_token: igToken,
        }),
      },
    );
    const publishData = await publishRes.json();
    if (!publishData.id) {
      return NextResponse.json({
        error: publishData.error?.message || "reel publish failed",
      });
    }

    // Mark the video as used — same semantic as photos in feed.
    // We need to re-upsert the full settings row with updated JSON.
    // PostgREST builder doesn't expose .catch(); use try/catch.
    const key = `video_${video.id}`;
    const updatedValue = { ...video, used_in_post_id: publishData.id };
    try {
      await sb.from("settings").upsert(
        {
          key,
          value: JSON.stringify(updatedValue),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    } catch {}

    // Log the post in ig_posts for analytics.
    try {
      await sb.from("ig_posts").insert({
        image_url: video.public_url,
        caption,
        status: "published",
        ig_media_id: publishData.id,
        published_at: new Date().toISOString(),
        schedule_time: new Date().toISOString(),
        metadata: { kind: "reel", video_id: video.id },
      });
    } catch {}

    await logRateLimitAction("post_publish", {
      media_id: publishData.id,
      kind: "reel",
      video_id: video.id,
    });

    await sendTelegram(
      `🎥 <b>Reel published!</b>\n\nAngle: ${angle}\n\nCaption preview: "${caption.slice(0, 120)}..."`,
    );

    return NextResponse.json({
      ok: true,
      media_id: publishData.id,
      video_id: video.id,
    });
  } catch (err: any) {
    await sendTelegram(`❌ Reel publish error: ${err?.message ?? err}`);
    return NextResponse.json({ error: err?.message ?? "unknown" });
  }
}
