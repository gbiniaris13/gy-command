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

  // Pick an unused photo from library
  const { data: photos } = await sb
    .from("ig_photos")
    .select("id, public_url")
    .is("used_in_post_id", null)
    .order("uploaded_at", { ascending: false })
    .limit(10);

  if (!photos || photos.length === 0) {
    await sendTelegram("⚠️ No photos available for Stories. Add more to ~/Desktop/ROBERTO IG/");
    return NextResponse.json({ error: "no photos" });
  }

  // Pick a random photo (don't use the same order as posts)
  const photo = photos[Math.floor(Math.random() * Math.min(photos.length, 5))];

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
      // Don't mark photo as used for stories (only posts use up photos)
      await sendTelegram(`📱 <b>Story published</b>\nTheme: ${theme}`);
      return NextResponse.json({ ok: true, media_id: publishData.id, theme });
    }

    return NextResponse.json({ error: publishData.error?.message || "publish failed" });
  } catch (err) {
    return NextResponse.json({ error: err.message });
  }
}
