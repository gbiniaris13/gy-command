// Draws a carousel text card and gives back a public JPEG address for it.
//
// The card is drawn by this deployment's own /api/og/post-card and stored
// in Cloudinary (folder gy-ig/cards), because Instagram fetches carousel
// images from a public address and refuses anything but JPEG. A card that
// cannot be drawn or stored comes back as null and is simply left out of
// the carousel: a post with one card fewer is better than no post.

import { uploadImageBytes } from "@/lib/ig-media";
import type { Card } from "@/lib/fleet-cards";

export function cardOgUrl(appBaseUrl: string, card: Card, size: { width: number; height: number }): string {
  return (
    `${appBaseUrl}/api/og/post-card?w=${size.width}&h=${size.height}` +
    `&card=${encodeURIComponent(JSON.stringify(card))}`
  );
}

export async function renderCardToUrl(
  appBaseUrl: string,
  card: Card,
  size: { width: number; height: number },
  slug: string,
): Promise<string | null> {
  try {
    // The card route answers only the cron secret or a dashboard session.
    // The secret is sent to this app's own address and nowhere else.
    const secret = process.env.CRON_SECRET;
    const res = await fetch(cardOgUrl(appBaseUrl, card, size), {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error(`[fleet-card-render] ${card.kind} card: HTTP ${res.status}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Only a real JPEG is worth storing: FF D8.
    if (bytes.byteLength < 1000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      console.error(`[fleet-card-render] ${card.kind} card: not a JPEG (${bytes.byteLength} bytes)`);
      return null;
    }
    const day = new Date().toISOString().slice(0, 10);
    const safeSlug = String(slug || "yacht").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "yacht";
    const publicId = `gy-ig/cards/${day}/${safeSlug}-${card.kind}-${Date.now()}`;
    const up = await uploadImageBytes(bytes, "image/jpeg", publicId);
    return typeof up?.url === "string" && up.url.startsWith("https://") ? up.url : null;
  } catch (err) {
    console.error(`[fleet-card-render] ${card.kind} card threw:`, err);
    return null;
  }
}
