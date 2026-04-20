// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { sendTelegram } from "@/lib/telegram";

// Cron: daily 09:00 UTC (12:00 Athens) — publishes 1 Story per day.
// Uses a photo from the ROBERTO IG library + AI-generated quote overlay.
// Instagram Stories API: media_type=STORIES with image_url.

const QUOTE_THEMES = [
  "Greek sea wisdom — a poetic one-liner about the Aegean",
  "Charter life insight — what most people don't know about yacht charters",
  "Island secret — a hidden gem fact about a Greek island",
  "Luxury philosophy — what real luxury means (hint: it's time, not things)",
  "Broker confession — a candid, warm thought from a charter broker's day",
  "Sailing wisdom — something the sea teaches you",
  "Guest moment — a beautiful unnamed client moment on a yacht",
];

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

  // ── Photo rotation: no back-to-back duplicates, 30-day cooldown ──
  // Pool = photos never used in a feed post AND (never shown in a story
  // OR shown > 30 days ago). Ordered least-recently-used first so a
  // photo used yesterday won't reappear until every other eligible
  // photo has had its turn.
  const COOLDOWN_DAYS = 30;
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_DAYS * 86400000).toISOString();

  let { data: photos, error: queryError } = await sb
    .from("ig_photos")
    .select("id, public_url, last_story_at")
    .is("used_in_post_id", null)
    .or(`last_story_at.is.null,last_story_at.lt.${cooldownCutoff}`)
    .order("last_story_at", { ascending: true, nullsFirst: true })
    .limit(20);

  // Self-heal: if the rotation column hasn't been migrated yet, fall
  // back to the old "newest-first random-pick" behavior so today's
  // story still publishes, and ping George to run the SQL.
  let migrationPending = false;
  if (queryError && /last_story_at/i.test(queryError.message || "")) {
    migrationPending = true;
    const { data: legacy } = await sb
      .from("ig_photos")
      .select("id, public_url")
      .is("used_in_post_id", null)
      .order("uploaded_at", { ascending: false })
      .limit(10);
    photos = legacy ? legacy.map((p) => ({ ...p, last_story_at: null })) : [];
    await sendTelegram(
      "⚠️ <b>Story rotation fix pending</b>\n\nRun this in Supabase SQL editor to stop duplicate stories:\n\n<code>ALTER TABLE public.ig_photos ADD COLUMN IF NOT EXISTS last_story_at timestamptz;\nCREATE INDEX IF NOT EXISTS idx_ig_photos_last_story_at ON public.ig_photos(last_story_at ASC NULLS FIRST);</code>\n\nUntil then, using old picker (may still repeat)."
    );
  }

  // Fallback: library is smaller than the cooldown window. Instead of
  // failing, pick from the LEAST recently used photos overall.
  if (!migrationPending && (!photos || photos.length === 0)) {
    const { data: fallback } = await sb
      .from("ig_photos")
      .select("id, public_url, last_story_at")
      .is("used_in_post_id", null)
      .order("last_story_at", { ascending: true, nullsFirst: true })
      .limit(10);
    photos = fallback || [];
  }

  if (!photos || photos.length === 0) {
    await sendTelegram("⚠️ No photos available for Stories. Add more to ~/Desktop/ROBERTO IG/");
    return NextResponse.json({ error: "no photos" });
  }

  // Back-to-back guard: never pick the photo used in the most recent
  // story, even if the cooldown window would otherwise allow it (tiny
  // library edge case). Skipped when the migration hasn't run yet.
  let lastStoryPhotoId: string | null = null;
  if (!migrationPending) {
    const { data: lastUsed } = await sb
      .from("ig_photos")
      .select("id")
      .not("last_story_at", "is", null)
      .order("last_story_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastStoryPhotoId = lastUsed?.id ?? null;
  }

  const eligible = lastStoryPhotoId
    ? photos.filter((p) => p.id !== lastStoryPhotoId)
    : photos;
  // If the guard drained the pool (pool of 1 that equals lastId), fall
  // back to the original list so we still publish something.
  const pool = eligible.length > 0 ? eligible : photos;

  // Pick from the top of the LRU-ordered pool with a little randomness
  // so the sequence isn't perfectly deterministic.
  const photo = pool[Math.floor(Math.random() * Math.min(pool.length, 5))];

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
      // Stamp last_story_at so the rotation logic knows this photo is
      // now on cooldown. We still do NOT set used_in_post_id — that
      // column is for feed posts only, so stories can reuse photos
      // once the 30-day cooldown expires. Skipped silently if the
      // migration hasn't run yet (the Telegram nudge already fired).
      if (!migrationPending) {
        await sb
          .from("ig_photos")
          .update({ last_story_at: new Date().toISOString() })
          .eq("id", photo.id);
      }

      await sendTelegram(`📱 <b>Story published</b>\nTheme: ${theme}`);
      return NextResponse.json({ ok: true, media_id: publishData.id, theme });
    }

    return NextResponse.json({ error: publishData.error?.message || "publish failed" });
  } catch (err) {
    return NextResponse.json({ error: err.message });
  }
}
