// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { sendTelegram } from "@/lib/telegram";

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

export async function GET() {
  const igToken = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return NextResponse.json({ error: "IG not configured" });
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
  const { data: allPhotos } = await sb
    .from("ig_photos")
    .select("id, public_url")
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
  const photo = topSlice[Math.floor(Math.random() * topSlice.length)];

  try {
    // Create Story container
    const createRes = await fetch(`https://graph.instagram.com/v21.0/${igId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: photo.public_url,
        media_type: "STORIES",
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
        `https://graph.instagram.com/v21.0/${createData.id}?fields=status_code&access_token=${encodeURIComponent(igToken)}`
      );
      const statusData = await statusRes.json();
      if (statusData.status_code === "FINISHED") { ready = true; break; }
      if (statusData.status_code === "ERROR") break;
    }

    if (!ready) {
      return NextResponse.json({ error: "Story processing timeout" });
    }

    // Publish
    const publishRes = await fetch(`https://graph.instagram.com/v21.0/${igId}/media_publish`, {
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
      await sb
        .from("settings")
        .upsert(
          {
            key: ROTATION_KEY,
            value: JSON.stringify(nextState),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        )
        .catch(() => {});

      await sendTelegram(`📱 <b>Story published</b>\nTheme: ${theme}`);
      return NextResponse.json({ ok: true, media_id: publishData.id, theme });
    }

    return NextResponse.json({ error: publishData.error?.message || "publish failed" });
  } catch (err) {
    return NextResponse.json({ error: err.message });
  }
}
