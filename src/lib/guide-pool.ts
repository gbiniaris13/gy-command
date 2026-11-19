// The fleet as the guide carousels see it: cleared for social (the pool
// is already filtered against the social policy by sanity-fleet), each
// yacht with her known exterior photographs in gallery order.

import { fetchFleetPool } from "@/lib/sanity-fleet";
import { loadShots, igFriendlyUrl } from "@/lib/ig-shots";
import type { GuideYacht } from "@/lib/guide-decks";

export async function loadGuidePool(): Promise<GuideYacht[]> {
  const pool = await fetchFleetPool();
  if (!pool.length) return [];
  const urlsOf = (y: any): string[] =>
    (y.images ?? []).map((i: any) => i?.url).filter((u: any) => typeof u === "string" && u.length > 10);
  const shots = await loadShots(pool.flatMap(urlsOf));
  return pool
    .map((y: any) => ({
      ...y,
      exteriors: urlsOf(y).filter((u) => shots.get(u) === "exterior" && igFriendlyUrl(u)),
    }))
    // Stable order, so "turn N" means the same yacht whichever instance runs.
    .sort((a: any, b: any) => String(a._id).localeCompare(String(b._id)));
}
