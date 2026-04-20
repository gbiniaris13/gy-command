// @ts-nocheck
/**
 * Sanity CMS fleet fetcher.
 *
 * Phase D.1 — pulls yacht documents from the public `ecqr94ey`
 * production dataset via the CDN REST API. No @sanity/client dep
 * needed (the fetches are read-only, public, and simple GROQ queries).
 *
 * Pool filter applied at query level: `count(images) >= 6`. Yachts
 * below that threshold can't produce a carousel of 5+ slides, so we
 * never surface them — independent of per-angle eligibility which is
 * decided later in fleet-rotation.ts.
 */

const SANITY_PROJECT = "ecqr94ey";
const SANITY_DATASET = "production";
const SANITY_API_VERSION = "2024-01-01";

// CDN endpoint is fine for read-only fleet queries (fresher than raw
// API for our 2026 latency profile, public dataset, no auth needed).
const SANITY_CDN = `https://${SANITY_PROJECT}.apicdn.sanity.io/v${SANITY_API_VERSION}/data/query/${SANITY_DATASET}`;

export type FleetYacht = {
  _id: string;
  name: string;
  slug: string | null;
  subtitle: string | null;
  category:
    | "motor-yachts"
    | "sailing-catamarans"
    | "power-catamarans"
    | "sailing-monohulls"
    | null;
  fleetTier: "private" | "explorer" | "both" | null;
  georgeInsiderTip: string | null;
  length: string | null;
  sleeps: string | null;
  cabins: string | null;
  crew: string | null;
  builder: string | null;
  yearBuiltRefit: string | null;
  cruisingRegion: string | null;
  weeklyRatePrice: string | null;
  features: string[];
  toys: string[];
  idealFor: string | null;
  images: Array<{ url: string; alt: string | null }>;
};

const FLEET_QUERY = `*[_type == "yacht" && count(images) >= 6]{
  _id,
  name,
  "slug": slug.current,
  subtitle,
  category,
  fleetTier,
  georgeInsiderTip,
  length,
  sleeps,
  cabins,
  crew,
  builder,
  yearBuiltRefit,
  cruisingRegion,
  weeklyRatePrice,
  "features": coalesce(features, []),
  "toys": coalesce(toys, []),
  idealFor,
  "images": images[]{
    "url": asset->url,
    alt
  }
}`;

/**
 * Fetch the full fleet pool (yachts with ≥6 images).
 * Returns [] on any error so the caller can fall back silently.
 */
export async function fetchFleetPool(): Promise<FleetYacht[]> {
  try {
    const url = `${SANITY_CDN}?query=${encodeURIComponent(FLEET_QUERY)}`;
    const res = await fetch(url, {
      // Don't ISR-cache — fleet data (especially prices) should refresh
      // on every cron firing. Sanity's CDN already caches server-side
      // so this isn't a cost issue.
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = await res.json();
    const result = Array.isArray(body?.result) ? body.result : [];
    return result.filter((y: any) => y && y._id && y.name);
  } catch {
    return [];
  }
}

/**
 * Fetch a single yacht by Sanity _id. Used by the dryrun endpoint.
 */
export async function fetchYachtById(id: string): Promise<FleetYacht | null> {
  try {
    const query = `*[_type == "yacht" && _id == $id][0]{
      _id, name, "slug": slug.current, subtitle, category, fleetTier,
      georgeInsiderTip, length, sleeps, cabins, crew, builder,
      yearBuiltRefit, cruisingRegion, weeklyRatePrice,
      "features": coalesce(features, []),
      "toys": coalesce(toys, []),
      idealFor,
      "images": images[]{ "url": asset->url, alt }
    }`;
    const url = `${SANITY_CDN}?query=${encodeURIComponent(query)}&$id=${encodeURIComponent(JSON.stringify(id))}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.result ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the UTM campaign string for a fleet post. Logged so the bio
 * link page (future Phase) can surface the right active campaign.
 */
export function buildFleetUTM(yacht: FleetYacht, angle: string): string {
  const slug = (yacht.slug ?? yacht._id).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const params = new URLSearchParams({
    utm_source: "instagram",
    utm_medium: "bio",
    utm_campaign: `boat_${slug}`,
    utm_content: `angle_${angle}`,
  });
  return `https://georgeyachts.com/ig?${params.toString()}`;
}
