// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";

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
export async function GET() {
  const token = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!token || !igId) {
    return NextResponse.json({ error: "IG not configured", processed: 0 });
  }

  const sb = createServiceClient();
  const { data: posts } = await sb
    .from("ig_posts")
    .select("*")
    .eq("status", "scheduled")
    .lte("schedule_time", new Date().toISOString());

  let processed = 0;

  for (const post of posts ?? []) {
    try {
      // Swap placeholder image for a ROBERTO IG library photo BEFORE we
      // touch Instagram. Pure no-op if the post already points at the
      // library or if the library is empty.
      const resolvedImageUrl = await swapImageFromLibrary(sb, post);
      post.image_url = resolvedImageUrl;

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
