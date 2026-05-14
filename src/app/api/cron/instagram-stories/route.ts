// @ts-nocheck
import { NextResponse } from "next/server";

// Story container create+poll+publish can hit 30-60s. Raise Vercel's
// function timeout so jitter + processing don't get 504'd.
export const maxDuration = 300;

import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import {
  applyPublishJitter,
  checkRateLimitHealth,
  logRateLimitAction,
} from "@/lib/rate-limit-guard";
import { getIgTokenOptional } from "@/lib/ig-token";
import { classifyPhotoForStory, type StoryLinkResult } from "@/lib/story-link";
import { fetchFleetForStories } from "@/lib/sanity-fleet";
import { publishPhotoStory } from "@/lib/facebook-client";
import {
  composeAndUploadStoryImage,
  pruneOldStoryComposites,
} from "@/lib/story-image-uploader";

// Cron: daily 09:00 UTC (12:00 Athens) — publishes 1 Story per day.
// Uses a photo from the ROBERTO IG library + AI-generated quote overlay.
// Instagram Stories API: media_type=STORIES with image_url.
//
// Rotation state is stored in the `settings` key-value table under the
// key ROTATION_KEY below. No DDL required — works out of the box on
// any project that already has the settings table (every gy-command
// env does). The value is a JSON blob:
//   { lastByPhotoId: { "<uuid>": "<iso>", ... }, lastStoryPhotoId: "<uuid>" }
// See `instagram-trending/route.ts` for the same key-value pattern.

const QUOTE_THEMES = [
  "Greek sea wisdom — a poetic one-liner about the Aegean",
  "Charter life insight — what most people don't know about yacht charters",
  "Island secret — a hidden gem fact about a Greek island",
  "Luxury philosophy — what real luxury means (hint: it's time, not things)",
  "Broker confession — a candid, warm thought from a charter broker's day",
  "Sailing wisdom — something the sea teaches you",
  "Guest moment — a beautiful unnamed client moment on a yacht",
];

const ROTATION_KEY = "story_rotation_v1";
const COOLDOWN_DAYS = 30;

// 2026-05-14 — Boss directive: stories rotate yacht / greece / greece /
// yacht / greece / greece across the 63-yacht fleet. Slot counter
// drives the cadence; yacht rotation state tracks used yacht slugs
// in the current cycle and resets after the 63rd is consumed.
const SLOT_KEY = "story_slot_v1";
const YACHT_ROTATION_KEY = "story_yacht_rotation_v1";

type SlotState = { counter: number; updated_at: string };

interface YachtRotationState {
  usedSlugs: string[];
  lastSlug: string | null;
  cycleStartedAt: string | null;
  cyclesCompleted: number;
}

async function loadSlotCounter(sb: any): Promise<number> {
  try {
    const { data } = await sb
      .from("settings")
      .select("value")
      .eq("key", SLOT_KEY)
      .maybeSingle();
    if (!data?.value) return 0;
    const parsed: SlotState = JSON.parse(data.value);
    return Number.isInteger(parsed.counter) ? parsed.counter % 3 : 0;
  } catch {
    return 0;
  }
}

async function persistSlotCounter(sb: any, next: number): Promise<void> {
  try {
    await sb.from("settings").upsert(
      {
        key: SLOT_KEY,
        value: JSON.stringify({ counter: next % 3, updated_at: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {}
}

async function loadYachtRotation(sb: any): Promise<YachtRotationState> {
  try {
    const { data } = await sb
      .from("settings")
      .select("value")
      .eq("key", YACHT_ROTATION_KEY)
      .maybeSingle();
    if (!data?.value) {
      return {
        usedSlugs: [],
        lastSlug: null,
        cycleStartedAt: new Date().toISOString(),
        cyclesCompleted: 0,
      };
    }
    const parsed = JSON.parse(data.value);
    return {
      usedSlugs: Array.isArray(parsed.usedSlugs) ? parsed.usedSlugs : [],
      lastSlug: parsed.lastSlug ?? null,
      cycleStartedAt: parsed.cycleStartedAt ?? null,
      cyclesCompleted: Number.isFinite(parsed.cyclesCompleted) ? parsed.cyclesCompleted : 0,
    };
  } catch {
    return {
      usedSlugs: [],
      lastSlug: null,
      cycleStartedAt: new Date().toISOString(),
      cyclesCompleted: 0,
    };
  }
}

async function persistYachtRotation(sb: any, state: YachtRotationState): Promise<void> {
  try {
    await sb.from("settings").upsert(
      {
        key: YACHT_ROTATION_KEY,
        value: JSON.stringify(state),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {}
}

interface YachtStoryChoice {
  yachtSlug: string;
  yachtName: string;
  imageUrl: string;
  rotation: YachtRotationState; // updated state to persist after publish
}

async function pickNextYachtForStory(
  sb: any,
  rotation: YachtRotationState,
): Promise<YachtStoryChoice | null> {
  const fleet = await fetchFleetForStories();
  if (fleet.length === 0) return null;

  // Filter out yachts already used in this cycle; if every yacht is
  // used the cycle resets so we loop George's entire fleet again.
  let nextRotation = rotation;
  let pool = fleet.filter((y) => !rotation.usedSlugs.includes(y.slug ?? ""));
  if (pool.length === 0) {
    nextRotation = {
      usedSlugs: [],
      lastSlug: rotation.lastSlug,
      cycleStartedAt: new Date().toISOString(),
      cyclesCompleted: (rotation.cyclesCompleted ?? 0) + 1,
    };
    pool = fleet.slice();
  }

  // Avoid back-to-back of the same yacht across cycle boundaries.
  if (nextRotation.lastSlug && pool.length > 1) {
    pool = pool.filter((y) => y.slug !== nextRotation.lastSlug);
  }

  // Stable rotation: take the FIRST eligible yacht (Sanity already
  // returns a deterministic order). Mild shuffle inside the first
  // 3 so the sequence isn't perfectly predictable.
  const head = pool.slice(0, Math.min(3, pool.length));
  const chosen = head[Math.floor(Math.random() * head.length)];

  const yachtSlug = (chosen.slug as string) || "";
  const yachtName = chosen.name || yachtSlug;
  const imageUrl = chosen.images?.[0]?.url || "";
  if (!yachtSlug || !imageUrl) return null;

  const updatedRotation: YachtRotationState = {
    usedSlugs: [...nextRotation.usedSlugs, yachtSlug],
    lastSlug: yachtSlug,
    cycleStartedAt: nextRotation.cycleStartedAt,
    cyclesCompleted: nextRotation.cyclesCompleted,
  };

  return { yachtSlug, yachtName, imageUrl, rotation: updatedRotation };
}

async function _observedImpl(req?: Request) {
  const igToken = getIgTokenOptional();
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return NextResponse.json({ error: "IG not configured" });
  }

  // Phase A — rate-limit breaker + jitter.
  if (!(await checkRateLimitHealth("story_publish"))) {
    return NextResponse.json({ skipped: "rate_limit" });
  }
  // 2026-05-14 — only jitter on cron-fired invocations. Manual
  // hits (curl from a Mac, dashboard "fire now" button) shouldn't
  // burn the 60-s Edge proxy timeout idling in jitter.
  const isCronInvoke = !!req?.headers?.get?.("x-vercel-cron");
  if (isCronInvoke) {
    await applyPublishJitter();
  }

  const sb = createServiceClient();

  // Pick a theme based on day of year
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const theme = QUOTE_THEMES[dayOfYear % QUOTE_THEMES.length];

  // ── Load rotation state ──
  // Single JSON row in `settings` that tracks the last_used_at for
  // every photo and the most recent photo id (for the back-to-back
  // guard). If the row doesn't exist yet we start from scratch.
  const { data: stateRow } = await sb
    .from("settings")
    .select("value")
    .eq("key", ROTATION_KEY)
    .maybeSingle();

  let state: { lastByPhotoId: Record<string, string>; lastStoryPhotoId: string | null } = {
    lastByPhotoId: {},
    lastStoryPhotoId: null,
  };
  if (stateRow?.value) {
    try {
      const parsed = JSON.parse(stateRow.value);
      if (parsed && typeof parsed === "object") {
        state = {
          lastByPhotoId: parsed.lastByPhotoId ?? {},
          lastStoryPhotoId: parsed.lastStoryPhotoId ?? null,
        };
      }
    } catch {
      // Corrupt JSON — fall back to empty state, we'll overwrite it
      // on the next successful publish below.
    }
  }

  // ── Pull the full eligible library ──
  // Feed dedup lives on `used_in_post_id` — a photo already used in a
  // feed post is excluded from Stories too, matching the previous
  // behaviour. Library is expected to be a few hundred photos max,
  // so pulling them all is cheap and lets us sort LRU in memory.
  // 2026-05-14 — include tags/description/filename so the
  // story-link classifier (lib/story-link.ts) has enough signal
  // to route each story to a relevant page on georgeyachts.com.
  // Boss directive: "δε θέλω να ξαναδώ story χωρίς link από το site μας".
  const { data: allPhotos } = await sb
    .from("ig_photos")
    .select("id, public_url, tags, description, filename")
    .is("used_in_post_id", null);

  if (!allPhotos || allPhotos.length === 0) {
    await sendTelegram("⚠️ No photos available for Stories. Add more to ~/Desktop/ROBERTO IG/");
    return NextResponse.json({ error: "no photos" });
  }

  // ── Enrich + rank ──
  // lastUsedMs = 0 for photos never shown in a story, which sorts them
  // ahead of any used photo (LRU first).
  const now = Date.now();
  const cooldownMs = COOLDOWN_DAYS * 86400000;
  const enriched = allPhotos.map((p) => {
    const ts = state.lastByPhotoId[p.id];
    return {
      id: p.id,
      public_url: p.public_url,
      tags: p.tags ?? [],
      description: p.description ?? null,
      filename: p.filename ?? null,
      lastUsedMs: ts ? new Date(ts).getTime() : 0,
    };
  });

  // 1. Cooldown filter: prefer photos outside the 30-day window.
  let pool = enriched.filter((p) => now - p.lastUsedMs >= cooldownMs);
  // 2. If the filter empties the pool (small library), fall back to
  //    everyone — the LRU sort below still keeps repetition minimal.
  if (pool.length === 0) pool = enriched;

  // 3. Sort LRU: least recently used (or never used) first.
  pool.sort((a, b) => a.lastUsedMs - b.lastUsedMs);

  // 4. Back-to-back guard: never pick the literal previous photo, even
  //    if somehow the cooldown would allow it (tiny library edge).
  if (state.lastStoryPhotoId && pool.length > 1) {
    pool = pool.filter((p) => p.id !== state.lastStoryPhotoId);
  }

  // 5. Pick from the top of the LRU-ordered pool with a little
  //    randomness so the sequence isn't perfectly deterministic when
  //    several never-used photos are tied.
  const topSlice = pool.slice(0, Math.min(pool.length, 5));
  let photo: typeof topSlice[number] | { id: string; public_url: string; tags?: string[]; description?: string | null; filename?: string | null } =
    topSlice[Math.floor(Math.random() * topSlice.length)];

  // 2026-05-14 — Boss-directed fleet rotation: slot 0 = yacht story,
  // slots 1 & 2 = Greece library photos. The yacht-rotation state
  // tracks which of the 63 yachts have been shown in the current
  // cycle; once all 63 are exhausted the cycle resets and we loop
  // through them again.
  const slotCounter = await loadSlotCounter(sb);
  const isYachtSlot = slotCounter % 3 === 0;
  let yachtChoice: YachtStoryChoice | null = null;
  if (isYachtSlot) {
    const rotation = await loadYachtRotation(sb);
    yachtChoice = await pickNextYachtForStory(sb, rotation);
    if (yachtChoice) {
      // Synthetic photo object so the rest of the publish pipeline
      // (Meta API, rotation state, Telegram card) sees a uniform
      // shape regardless of whether the source is fleet or library.
      photo = {
        id: `yacht:${yachtChoice.yachtSlug}`,
        public_url: yachtChoice.imageUrl,
        tags: [yachtChoice.yachtSlug],
        description: `Yacht story — ${yachtChoice.yachtName}`,
        filename: yachtChoice.yachtSlug,
      };
    }
    // If yachtChoice is null (fleet fetch failed) we silently fall
    // back to the library photo selected above — the story still ships.
  }

  // 2026-05-14 — classify the photo and pick the destination URL the
  // story should drive traffic to. Yacht-slot photos route directly
  // to /yachts/<slug> via the synthetic tag injected above.
  const linkTarget: StoryLinkResult = classifyPhotoForStory(photo);

  // 2026-05-14 — bake a visible URL banner onto the story image.
  // Meta's Content Publishing API does NOT permit adding Instagram
  // Link Stickers programmatically (app-only feature, no API path
  // even for Business accounts), so we make the destination URL
  // visible directly inside the photo. Viewers can long-press the
  // URL on iOS to open it, or simply type it into a browser.
  //
  // We hand the story-image generator the SHORT display URL (without
  // the long UTM tail) so the banner stays legible.
  let displayUrlForBanner = linkTarget.url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("?")[0];
  if (displayUrlForBanner.length > 64) {
    displayUrlForBanner = displayUrlForBanner.slice(0, 60) + "…";
  }
  // The cron's app baseUrl — we read the Vercel system env var so
  // dev/preview deploys generate against their own host.
  const appHost =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    "https://command.georgeyachts.com";
  const appBaseUrl = appHost.startsWith("http") ? appHost : `https://${appHost}`;
  // 2026-05-14 — Meta refuses dynamic Edge URLs for STORIES even
  // when the response is image/png ("Only photo or video can be
  // accepted as media type"). Workaround: pre-render the composed
  // image, upload to a public Supabase Storage bucket, then hand
  // Meta that static URL. Free (1 GB tier), 7-day auto-prune.
  //
  // The OG endpoint also accepts a top caption (title + subtitle)
  // so every story is visually self-contained — no more silent
  // photo-only stories that "δεν λένε τίποτα" per George's
  // 2026-05-14 ping.
  const ogTitle = yachtChoice ? yachtChoice.yachtName : "From Greek Waters";
  const ogSubtitle = yachtChoice
    ? "Crewed yacht charter · Greece"
    : (theme || "").slice(0, 90);
  const composedStoryImageUrl = await composeAndUploadStoryImage({
    photoUrl: photo.public_url,
    displayUrl: displayUrlForBanner,
    eyebrow: yachtChoice ? "Tap to view yacht" : "Visit georgeyachts.com",
    title: ogTitle,
    subtitle: ogSubtitle,
    appBaseUrl,
  });
  // Best-effort housekeeping — don't await on the critical path.
  pruneOldStoryComposites().catch(() => {});

  try {
    // Create Story container. We pass `link` defensively — most IG
    // Graph API revisions ignore unknown fields rather than rejecting,
    // and if Meta ever enables link stickers via Content Publishing
    // for our follower tier it will start working for free without
    // a code change. The Telegram alert is the source of truth for
    // George until then.
    const createRes = await fetch(`https://graph.facebook.com/v21.0/${igId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // 2026-05-14 — pass the COMPOSED image (photo + URL banner)
        // so the destination URL is visible inside the story.
        // composedStoryImageUrl points at our /api/og/story-image
        // Edge endpoint which is publicly fetchable by Meta.
        image_url: composedStoryImageUrl,
        media_type: "STORIES",
        link: linkTarget.url,
        access_token: igToken,
      }),
    });
    const createData = await createRes.json();

    if (!createData.id) {
      const err = createData.error?.message || "container failed";
      await sendTelegram(`❌ Story creation failed: ${err}`);
      return NextResponse.json({ error: err });
    }

    // Wait for processing
    let ready = false;
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(
        `https://graph.facebook.com/v21.0/${createData.id}?fields=status_code&access_token=${encodeURIComponent(igToken)}`
      );
      const statusData = await statusRes.json();
      if (statusData.status_code === "FINISHED") { ready = true; break; }
      if (statusData.status_code === "ERROR") break;
    }

    if (!ready) {
      return NextResponse.json({ error: "Story processing timeout" });
    }

    // Publish
    const publishRes = await fetch(`https://graph.facebook.com/v21.0/${igId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: igToken,
      }),
    });
    const publishData = await publishRes.json();

    if (publishData.id) {
      // ── Persist rotation state ──
      // Stamp this photo as "used now" in the map and record it as the
      // last-picked id so the back-to-back guard works tomorrow.
      // Feed dedup (used_in_post_id) is intentionally NOT touched —
      // that column is for feed posts only, so stories can reuse
      // photos once the 30-day cooldown expires.
      const nextState = {
        lastByPhotoId: {
          ...state.lastByPhotoId,
          [photo.id]: new Date().toISOString(),
        },
        lastStoryPhotoId: photo.id,
      };
      // The PostgREST builder isn't a real promise until awaited, so the
      // dangling `.catch()` previously threw "x.catch is not a function"
      // every story run (21 errors / 7 days). Wrap in try/catch instead.
      try {
        await sb.from("settings").upsert(
          {
            key: ROTATION_KEY,
            value: JSON.stringify(nextState),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );
      } catch {
        // Best-effort rotation persistence — don't break publishing.
      }

      // 2026-05-14 — advance slot counter (0→1→2→0) so the next story
      // run lands on the right rotation slot. Yacht rotation state
      // only changes when we just shipped a yacht slot.
      await persistSlotCounter(sb, (slotCounter + 1) % 3);
      if (yachtChoice) {
        await persistYachtRotation(sb, yachtChoice.rotation);
      }

      await logRateLimitAction("story_publish", {
        media_id: publishData.id,
        photo_id: photo.id,
        story_link_url: linkTarget.url,
        story_link_category: linkTarget.category,
        slot_kind: isYachtSlot ? "yacht" : "greece",
        yacht_slug: yachtChoice?.yachtSlug ?? null,
      });
      // 2026-05-14 — Telegram now carries the resolved link target so
      // George can swipe-into the just-published story on his phone
      // and add the official Instagram link sticker in ~5 seconds
      // (Meta blocks adding link stickers via the public Content
      // Publishing API — sending `link` in the create call above is
      // a defensive hedge, not a guarantee).
      // 2026-05-14 — also mirror the SAME composed image to Facebook.
      // FB Stories get the URL banner overlay just like IG so the
      // mirror reads identically across both platforms.
      let fbMirrorLine = "";
      try {
        const fb = await publishPhotoStory({ photoUrl: composedStoryImageUrl });
        if (fb.ok) {
          fbMirrorLine = `\n📘 FB Story mirrored · post_id ${fb.post_id}`;
        } else {
          fbMirrorLine = `\n⚠️ FB Story mirror failed: ${fb.error?.slice(0, 120) ?? "unknown"}`;
        }
      } catch (e: any) {
        fbMirrorLine = `\n⚠️ FB Story mirror exception: ${(e?.message ?? "unknown").slice(0, 120)}`;
      }

      const slotKind = isYachtSlot ? "🚢 Yacht slot" : "🇬🇷 Greece slot";
      const yachtLine = yachtChoice
        ? `\n<b>Yacht:</b> ${yachtChoice.yachtName} (slug: ${yachtChoice.yachtSlug})`
        : "";
      // 2026-05-14 — Telegram card embeds the composed PNG URL so
      // George can long-press → "Save Image" on iPhone and re-post
      // a fresh story in IG WITH the official Link sticker (the
      // only way Meta lets you actually attach a clickable link).
      const tgLines = [
        `📱 <b>Story published</b> · ${slotKind}`,
        `Theme: ${theme}${yachtLine}${fbMirrorLine}`,
        ``,
        `🔗 <b>Link target:</b>`,
        `<code>${linkTarget.url}</code>`,
        ``,
        `<b>Want the official clickable Link sticker?</b>`,
        `1. Tap the image below → Save Image`,
        `2. IG app → swipe right (Story camera) → 🖼️ pick saved image`,
        `3. 🎁 sticker → <b>Link</b> → paste the URL above`,
        `4. Post the new story`,
        `<i>(Optional — the auto-posted story already shows the URL banner readable in the photo.)</i>`,
        ``,
        `🖼️ <a href="${composedStoryImageUrl}">Composed story image (1080×1920)</a>`,
        ``,
        `<i>Routing reason: ${linkTarget.label} (${linkTarget.matched})</i>`,
      ];
      await sendTelegram(tgLines.join("\n"));
      return NextResponse.json({
        ok: true,
        media_id: publishData.id,
        theme,
        story_link: linkTarget,
      });
    }

    return NextResponse.json({ error: publishData.error?.message || "publish failed" });
  } catch (err) {
    return NextResponse.json({ error: err.message });
  }
}


// Observability wrapper — records success/error/skipped/timeout
// outcomes to settings KV for the Thursday ops report.
export async function GET(...args: any[]) {
  return observeCron("instagram-stories", () => (_observedImpl as any)(...args));
}
