// Draws a guide slide and gives back a public JPEG address for it.
//
// The slide is drawn by this deployment's own /api/og/guide-card and
// stored in Cloudinary (folder gy-ig/guides), because Instagram fetches
// carousel images from a public address and takes JPEG only. A slide that
// cannot be drawn or stored comes back as null; the caller decides whether
// the carousel can go out without it.

import { uploadImageBytes } from "@/lib/ig-media";
import type { GuideSlide } from "@/lib/guide-decks";

export function guideOgUrl(appBaseUrl: string, slide: GuideSlide, i: number, n: number): string {
  return `${appBaseUrl}/api/og/guide-card?i=${i}&n=${n}&slide=${encodeURIComponent(JSON.stringify(slide))}`;
}

export async function renderGuideSlideToUrl(
  appBaseUrl: string,
  slide: GuideSlide,
  i: number,
  n: number,
  deckId: string,
): Promise<string | null> {
  try {
    // The card route answers only the cron secret or a dashboard session.
    // The secret is sent to this app's own address and nowhere else.
    const secret = process.env.CRON_SECRET;
    const res = await fetch(guideOgUrl(appBaseUrl, slide, i, n), {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(28_000),
    });
    if (!res.ok) {
      console.error(`[guide-render] ${deckId} slide ${i} (${slide.kind}): HTTP ${res.status}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Only a real JPEG is worth storing: FF D8.
    if (bytes.byteLength < 1000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      console.error(`[guide-render] ${deckId} slide ${i}: not a JPEG (${bytes.byteLength} bytes)`);
      return null;
    }
    const day = new Date().toISOString().slice(0, 10);
    const safe = String(deckId || "guide").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "guide";
    const publicId = `gy-ig/guides/${day}/${safe}-${String(i).padStart(2, "0")}-${Date.now()}`;
    const up = await uploadImageBytes(bytes, "image/jpeg", publicId);
    return typeof up?.url === "string" && up.url.startsWith("https://") ? up.url : null;
  } catch (err) {
    console.error(`[guide-render] ${deckId} slide ${i} threw:`, err);
    return null;
  }
}
