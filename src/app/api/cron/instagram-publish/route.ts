// @ts-nocheck
import { NextResponse } from "next/server";

// Feed publish loops over multiple scheduled posts. With jitter +
// processing, runtime can exceed the default 60s Vercel cap. Raise
// it so we don't 504 mid-batch.
export const maxDuration = 300;

import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { sendTelegram } from "@/lib/telegram";
import {
  applyPublishJitter,
  checkRateLimitHealth,
  logRateLimitAction,
} from "@/lib/rate-limit-guard";
import { assertPublishAllowed } from "@/lib/ig-window-guard";
import { stripBannedHashtags } from "@/lib/hashtag-guard";
import { isCaptionTooSimilar } from "@/lib/caption-similarity";
import { observeCron } from "@/lib/cron-observer";

// Feature #9 — Caption quality guard. Returns a rejection reason if
// the caption isn't ship-worthy so the publish loop can block it,
// flip the post back to draft, and alert George via Telegram. Reasons
// are ordered from cheapest to most expensive so a short caption
// exits fast.
function captionQualityIssue(caption: string): string | null {
  const clean = (caption ?? "").trim();
  if (clean.length === 0) return "empty caption";
  if (clean.length < 100)
    return `caption too short (${clean.length} chars, need ≥100)`;
  // Strip hashtag block before word-count so the quality check
  // measures prose length, not hashtag padding
  const prose = clean.replace(/#\w+/g, "").trim();
  const wordCount = prose.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < 25)
    return `not enough prose (${wordCount} words after stripping hashtags)`;
  // Must have some yacht / charter / Greece anchor word to stay on-brand
  const anchors = /yacht|charter|greek|greece|aegean|ionian|cycl|hydra|mykonos|santorini|crew|sea|island|athens|broker/i;
  if (!anchors.test(prose)) return "no brand anchor keyword found";
  // Reject obvious placeholder text
  if (/lorem ipsum|TODO|TBD|placeholder/i.test(prose))
    return "contains placeholder text";
  return null;
}

// Cron: publishes scheduled Instagram posts when their time arrives.
//
// Just before the media container is created on IG, we swap the
// placeholder image_url (Pexels / Unsplash / anything not already
// pointing at the ig-photos bucket) for a photo George actually
// uploaded to the ROBERTO IG library. The Gemini matcher reads the
// post's caption and picks the best unused photo from public.ig_photos,
// then marks that photo as used_in_post_id = post.id so it can never
// be used again. If the library is empty, we leave the placeholder as
// a graceful fallback and keep publishing as before.

const LIBRARY_HOST = "lquxemsonehfltdzdbhq.supabase.co/storage/v1/object/public/ig-photos";

// Feature #3 — smart hashtag AI rotation. Just before the IG container
// is created, ask Gemini for 3-5 niche hashtags specific to this post's
// caption and append them. Skips if the caption already contains any
// hashtag (so manual captions George wrote with hashtags never get
// double-hashtagged, and retries don't pile them up).
async function addSmartHashtags(caption: string): Promise<string> {
  if (!caption || /#\w/.test(caption)) return caption ?? "";

  const prompt = `Generate 3-5 Instagram hashtags for this caption.

CAPTION:
${caption.slice(0, 1500)}

RULES:
- NO generic hashtags (#love, #instagood, #travel, #greece, #beautiful, #summer, #photooftheday)
- YES specific niche hashtags
- Mix: 2 location-specific (island, region, sea) + 2 industry-specific (yacht, charter, broker, crew) + 1 unique or trending angle
- Each hashtag starts with # and uses PascalCase

GOOD EXAMPLES:
#YachtCharterGreece #CycladesIslands #LuxuryYachtLife #SailingMykonos
#HydraIsland #IonianSea #GreekSummer #YachtBroker #CrewedYacht
#AmorgosIsland #SaronicGulf #MediterraneanYachting #MYBA #UHNW

BAD EXAMPLES:
#love #greece #travel #instagood #photooftheday #beautiful #summer

OUTPUT — return ONLY hashtags separated by single spaces. No explanation. No numbering. No quotes.`;

  try {
    const raw = await aiChat(
      "You return only Instagram hashtags separated by spaces. No other text.",
      prompt
    );
    // Extract every #Word token, cap at 5, dedupe, reject generics as a safety belt
    const generic = new Set([
      "love",
      "instagood",
      "travel",
      "greece",
      "beautiful",
      "summer",
      "photooftheday",
      "nature",
      "sea",
      "wanderlust",
      "vacation",
      "holiday",
    ]);
    const tokens = Array.from(new Set(raw.match(/#[A-Za-z0-9_]+/g) ?? []))
      .filter((t) => !generic.has(t.slice(1).toLowerCase()))
      .slice(0, 5);
    if (tokens.length === 0) return caption;
    return `${caption.trim()}\n\n${tokens.join(" ")}`;
  } catch {
    // Never break publishing because of hashtag generation
    return caption;
  }
}

async function swapImageFromLibrary(sb, post) {
  // Already points at the library? nothing to do.
  if (typeof post.image_url === "string" && post.image_url.includes(LIBRARY_HOST)) {
    return post.image_url;
  }

  const { data: photos } = await sb
    .from("ig_photos")
    .select("id, filename, public_url, description, tags")
    .is("used_in_post_id", null)
    .order("uploaded_at", { ascending: false })
    .limit(50);

  if (!photos || photos.length === 0) {
    // Nothing in the library — keep whatever URL the post already had.
    return post.image_url;
  }

  // Gemini match — same contract as /api/instagram/pick-local-image
  let pickedId: string | null = null;
  try {
    const shortlist = photos
      .map((p) => `- ${p.id} · ${p.description ?? p.filename} · [${(p.tags ?? []).join(", ")}]`)
      .join("\n");
    const raw = await aiChat(
      "You return only a single photo id from the provided list. No extra words.",
      `Match this Instagram caption to the best photo from the library.\n\nCAPTION:\n${(post.caption ?? "").slice(0, 1200)}\n\nPHOTOS (id · description · tags):\n${shortlist}\n\nReply with ONLY the photo id.`
    );
    const m = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) pickedId = m[0];
  } catch {
    // fall through to default
  }

  const picked = pickedId
    ? photos.find((p) => p.id === pickedId) ?? photos[0]
    : photos[0];

  // Atomic reserve: mark photo as used, persist new image_url on the post.
  await sb
    .from("ig_photos")
    .update({ used_in_post_id: post.id })
    .eq("id", picked.id)
    .is("used_in_post_id", null);

  await sb
    .from("ig_posts")
    .update({ image_url: picked.public_url })
    .eq("id", post.id);

  return picked.public_url;
}

// Cron: publishes scheduled Instagram posts when their time arrives
async function _observedImpl() {
  const token = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!token || !igId) {
    return NextResponse.json({ error: "IG not configured", processed: 0 });
  }

  // ROBERTO 2026-04-22 fix — hard window + daily-limit + 18h gap guard.
  // Blocks the post if we're outside 18:00–19:30 Athens, already posted
  // today, or closer than 18h to the last post. Telegrams George and
  // leaves scheduled rows intact so the next valid tick picks them up.
  const gate = await assertPublishAllowed({ postType: "feed" });
  if (!gate.allowed) {
    return NextResponse.json({
      skipped: "window_guard",
      reason: gate.reason,
      detail: gate.detail,
      processed: 0,
    });
  }

  // Phase A — rate-limit circuit breaker. Exits early + Telegram alert
  // if we're near Meta's hourly/daily cap for post publishing, or if
  // the global crons_paused flag is set (health check RED).
  if (!(await checkRateLimitHealth("post_publish"))) {
    return NextResponse.json({ skipped: "rate_limit", processed: 0 });
  }
  // Phase A — anti-bot timing jitter. 0-15 min random delay so the IG
  // API doesn't see us firing at exactly the cron scheduled time.
  await applyPublishJitter();

  const sb = createServiceClient();
  const { data: posts } = await sb
    .from("ig_posts")
    .select("*")
    .eq("status", "scheduled")
    .lte("schedule_time", new Date().toISOString());

  let processed = 0;

  for (const post of posts ?? []) {
    try {
      // Feature #9 — quality guard. Block anything that doesn't meet
      // the brand floor. Flip back to draft + Telegram alert so George
      // can fix it or cut it before the next tick.
      const qualityIssue = captionQualityIssue(post.caption ?? "");
      if (qualityIssue) {
        await sb
          .from("ig_posts")
          .update({ status: "draft", error: `quality_guard: ${qualityIssue}` })
          .eq("id", post.id);
        await sendTelegram(
          `⚠️ <b>IG post blocked by quality guard</b>\n<i>${qualityIssue}</i>\nFlipped back to draft — edit in /dashboard/instagram.`
        ).catch(() => {});
        continue;
      }

      // Swap placeholder image for a ROBERTO IG library photo BEFORE we
      // touch Instagram. Pure no-op if the post already points at the
      // library or if the library is empty.
      const resolvedImageUrl = await swapImageFromLibrary(sb, post);
      post.image_url = resolvedImageUrl;

      // Brand-integrity guard. 2026-04-22 a P/CAT ALENA fleet post went
      // live with an Unsplash stock photo because the source image URL
      // wasn't a real yacht photo — violated the no-fake-photos rule.
      // Block any image whose URL contains a known stock-photo tell, and
      // block fleet_yacht posts whose metadata doesn't carry a yacht id.
      const STOCK_PHOTO_PATTERNS = /unsplash|pexels|pixabay|shutterstock|getty|istockphoto|stock[-_ ]photo|placeholder/i;
      if (STOCK_PHOTO_PATTERNS.test(post.image_url ?? "")) {
        await sb
          .from("ig_posts")
          .update({
            status: "draft",
            error: `stock_photo_guard: image URL matched stock-photo deny list (${post.image_url})`,
          })
          .eq("id", post.id);
        await sendTelegram(
          `🚫 <b>IG post blocked — stock photo detected</b>\nPost: ${post.id.slice(0, 8)}\nURL: <code>${(post.image_url ?? "").slice(-60)}</code>\nFlipped to draft.`,
        ).catch(() => {});
        continue;
      }
      if (
        post.post_type === "fleet_yacht" &&
        (!post.metadata ||
          Object.keys(post.metadata).length === 0 ||
          !(post.metadata as { yacht_id?: string }).yacht_id)
      ) {
        await sb
          .from("ig_posts")
          .update({
            status: "draft",
            error: "fleet_yacht_metadata_missing: no yacht_id in metadata",
          })
          .eq("id", post.id);
        await sendTelegram(
          `🚫 <b>Fleet post blocked — missing yacht metadata</b>\nPost: ${post.id.slice(0, 8)}\nFleet posts must carry yacht_id + photos in metadata. Flipped to draft.`,
        ).catch(() => {});
        continue;
      }

      // Smart hashtag rotation — AI picks 3-5 niche hashtags specific
      // to this caption. No-op if the caption already has hashtags.
      const captionWithHashtags = await addSmartHashtags(post.caption ?? "");
      if (captionWithHashtags !== post.caption) {
        post.caption = captionWithHashtags;
        // Persist so the dashboard shows what actually went out, and so
        // a retry doesn't re-run the hashtag call
        await sb
          .from("ig_posts")
          .update({ caption: captionWithHashtags })
          .eq("id", post.id);
      }

      // Phase A — banned hashtag guard. Strip anything on the Meta
      // shadowban blocklist before we hand the caption to IG.
      const { cleaned, stripped } = await stripBannedHashtags(post.caption ?? "");
      if (stripped.length > 0) {
        post.caption = cleaned;
        await sb.from("ig_posts").update({ caption: cleaned }).eq("id", post.id);
        await sendTelegram(
          `⚠ Stripped banned hashtags from post ${post.id}: ${stripped.join(" ")}`,
        );
      }

      // Phase B — caption similarity check. Reject near-duplicates of
      // anything published in the last 50 posts. Non-blocking: if the
      // check fires, we log + alert but still publish (fail-open keeps
      // the feed alive; the alert tells George to nudge the voice).
      const sim = await isCaptionTooSimilar(post.caption ?? "");
      if (sim.similar) {
        await sendTelegram(
          `⚠ <b>Caption similarity flag</b>\nPost: ${post.id}\nReason: ${sim.reason ?? "n/a"}\nMatched: "${sim.matchedCaptionPreview ?? "n/a"}..."\n\nPublishing anyway (fail-open). Consider tweaking the weekly generator prompt if this repeats.`,
        );
      }

      // Mark as publishing
      await sb.from("ig_posts").update({ status: "publishing" }).eq("id", post.id);

      // Step 1: Create media container (use "me" for Instagram Login tokens)
      const containerRes = await fetch(
        `https://graph.instagram.com/v21.0/me/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: post.image_url,
            caption: post.caption,
            access_token: token,
          }),
        }
      );
      const containerData = await containerRes.json();
      if (!containerData.id) throw new Error(containerData.error?.message || "Container failed");

      // Step 1b: Wait for container to be ready (IG needs processing time)
      let containerReady = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((r) => setTimeout(r, 3000)); // wait 3s between checks
        const statusRes = await fetch(
          `https://graph.instagram.com/v21.0/${containerData.id}?fields=status_code&access_token=${encodeURIComponent(token)}`
        );
        const statusData = await statusRes.json();
        if (statusData.status_code === "FINISHED") {
          containerReady = true;
          break;
        }
        if (statusData.status_code === "ERROR") {
          throw new Error(`Container processing failed: ${statusData.status_code}`);
        }
        // IN_PROGRESS — keep polling
      }
      if (!containerReady) throw new Error("Container processing timed out after 30s");

      // Step 2: Publish
      const publishRes = await fetch(
        `https://graph.instagram.com/v21.0/me/media_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creation_id: containerData.id,
            access_token: token,
          }),
        }
      );
      const publishData = await publishRes.json();
      if (!publishData.id) throw new Error(publishData.error?.message || "Publish failed — no media ID returned");

      // Step 3: Update status
      await sb.from("ig_posts").update({
        status: "published",
        ig_media_id: publishData.id,
        published_at: new Date().toISOString(),
      }).eq("id", post.id);

      // Phase A — log successful publish for rate-limit accounting.
      await logRateLimitAction("post_publish", {
        post_id: post.id,
        ig_media_id: publishData.id,
      });

      processed++;
    } catch (err) {
      await sb.from("ig_posts").update({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }).eq("id", post.id);
    }
  }

  return NextResponse.json({ processed });
}


// Observability wrapper — records success/error/skipped/timeout
// outcomes to settings KV for the Thursday ops report.
export async function GET(...args: any[]) {
  return observeCron("instagram-publish", () => (_observedImpl as any)(...args));
}
