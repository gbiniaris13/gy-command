// Story-image composer + uploader.
//
// Meta's Content Publishing API silently rejects dynamic Edge URLs
// for STORIES (it expects a static image asset). To make our composed
// "photo + URL banner" image acceptable we:
//
//   1. Server-side fetch the rendered PNG from /api/og/story-image
//   2. Upload it to a public Supabase Storage bucket (free 1 GB tier)
//   3. Return the storage public URL — Meta accepts that fine
//
// The bucket auto-cleans entries older than 7 days because stories
// only need to exist for 24h; nothing here grows unboundedly.

import { createServiceClient } from "@/lib/supabase-server";

const BUCKET = "story-composites";

async function ensureBucket(sb: any): Promise<void> {
  try {
    const { data: list } = await sb.storage.listBuckets();
    if (!Array.isArray(list)) return;
    if (list.some((b: any) => b?.name === BUCKET)) return;
    await sb.storage.createBucket(BUCKET, { public: true });
  } catch {
    // Best-effort — if listBuckets/create fails we still try upload;
    // worst case the upload returns an explicit error to the caller.
  }
}

/**
 * Generate the composed story image (photo + URL banner) and upload
 * it to Supabase Storage. Returns the public URL of the uploaded PNG.
 *
 * If anything fails (OG render error, upload error, missing storage)
 * returns the raw input `photoUrl` so the caller can fall back to
 * the un-overlaid photo and still publish the story.
 */
export async function composeAndUploadStoryImage(args: {
  photoUrl: string;
  displayUrl: string;
  eyebrow: string;
  title?: string;
  subtitle?: string;
  appBaseUrl: string;
}): Promise<string> {
  const { photoUrl, displayUrl, eyebrow, title, subtitle, appBaseUrl } = args;

  // Step 1 — render the composed image via our OG endpoint.
  const ogUrl =
    `${appBaseUrl}/api/og/story-image` +
    `?photo=${encodeURIComponent(photoUrl)}` +
    `&url=${encodeURIComponent(displayUrl)}` +
    `&eyebrow=${encodeURIComponent(eyebrow)}` +
    (title ? `&title=${encodeURIComponent(title)}` : "") +
    (subtitle ? `&subtitle=${encodeURIComponent(subtitle)}` : "");

  let bytes: Uint8Array | null = null;
  try {
    // Hard 25s budget on the render — we'd rather ship a no-banner
    // story than burn the cron's 60-s Edge proxy timeout. If OG is
    // cold-starting or upstream Sanity/Supabase is slow, we'll fall
    // back transparently to the raw photo URL.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    let res: Response;
    try {
      res = await fetch(ogUrl, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      console.error("[story-image-uploader] OG fetch failed", res.status);
      return photoUrl;
    }
    const ab = await res.arrayBuffer();
    bytes = new Uint8Array(ab);
  } catch (e) {
    console.error("[story-image-uploader] OG fetch threw:", e);
    return photoUrl;
  }
  if (!bytes || bytes.byteLength === 0) return photoUrl;

  // Step 2 — upload to Supabase Storage and resolve public URL.
  try {
    const sb = createServiceClient();
    await ensureBucket(sb);

    const today = new Date().toISOString().slice(0, 10);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const storagePath = `${today}/${stamp}.png`;

    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: "image/png",
        upsert: false,
      });

    if (uploadErr) {
      console.error("[story-image-uploader] upload failed:", uploadErr.message);
      return photoUrl;
    }

    const { data: publicData } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
    return publicData?.publicUrl || photoUrl;
  } catch (e) {
    console.error("[story-image-uploader] upload threw:", e);
    return photoUrl;
  }
}

/**
 * Best-effort cleanup — delete any composite older than 7 days.
 * Called opportunistically by the IG stories cron so the bucket
 * never grows past a few MB. Failures are silent.
 */
export async function pruneOldStoryComposites(): Promise<void> {
  try {
    const sb = createServiceClient();
    const cutoff = new Date(Date.now() - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    // List recent date folders and delete files in any folder dated
    // before the cutoff.
    const { data: folders } = await sb.storage
      .from(BUCKET)
      .list("", { limit: 100, sortBy: { column: "name", order: "asc" } });
    if (!Array.isArray(folders)) return;
    for (const folder of folders) {
      if (!folder?.name) continue;
      if (folder.name >= cutoff) continue;
      const { data: files } = await sb.storage
        .from(BUCKET)
        .list(folder.name, { limit: 100 });
      if (!Array.isArray(files) || files.length === 0) continue;
      const paths = files.map((f: any) => `${folder.name}/${f.name}`);
      await sb.storage.from(BUCKET).remove(paths).catch(() => {});
    }
  } catch {
    // ignore
  }
}
