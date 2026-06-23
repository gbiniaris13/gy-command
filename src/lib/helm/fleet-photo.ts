// src/lib/helm/fleet-photo.ts
// =============================================================
// Auto-attach REAL fleet photos to a Helm proposal when the proposed
// yacht is one of our OWN fleet (matched by EXACT normalized name).
//
// HOUSE RULE: never a wrong/placeholder photo. We only return images
// when the normalized vessel name is EXACTLY equal to a fleet yacht's
// normalized name — no fuzzy/substring matching. A wrong photo is
// worse than no photo.
//
// Fail-safe by design: any Sanity/network error, or no confident
// match, returns [] so the caller's existing manual-photo behavior is
// completely unchanged.
// =============================================================

import { fetchFleetPool, type FleetYacht } from "@/lib/sanity-fleet";

/**
 * Normalize a vessel name for EXACT matching:
 *  - lowercase + trim, collapse internal whitespace to single spaces
 *  - strip a leading prefix: "M/Y ", "S/Y ", "S/CAT ", "MY ", "SY "
 *  - strip leading/trailing punctuation
 * Match ONLY when two normalized names are exactly equal.
 */
export function normalizeYachtName(name: string): string {
  let n = (name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  // Strip a single leading vessel-type prefix.
  n = n.replace(/^(m\/y|s\/y|s\/cat|my|sy)\s+/i, "");
  // Strip leading/trailing punctuation (keep inner chars intact).
  n = n.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
  return n.trim();
}

/**
 * Find a fleet yacht by EXACT normalized-name match within an
 * already-fetched pool. Returns its image URLs (in order) or [].
 */
function photosFromPool(pool: FleetYacht[], name: string): string[] {
  const target = normalizeYachtName(name);
  if (!target) return [];
  const match = pool.find((y) => y && y.name && normalizeYachtName(y.name) === target);
  if (!match || !Array.isArray(match.images)) return [];
  return match.images.map((im) => im?.url).filter((u): u is string => !!u);
}

/**
 * Lazily fetch the fleet pool ONCE and return the matched yacht's image
 * URLs for a single name, or [] on no confident match / any error.
 */
export async function fleetPhotosForName(name: string): Promise<string[]> {
  try {
    const pool = await fetchFleetPool();
    if (!Array.isArray(pool) || !pool.length) return [];
    return photosFromPool(pool, name);
  } catch {
    return [];
  }
}

/**
 * Batch variant: fetch the pool ONCE and resolve fleet photos for N
 * names. Returns a name-keyed map (original name string -> URLs). Names
 * with no confident match map to []. Fail-safe: any error -> all [].
 */
export async function fleetPhotosForNames(names: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const n of names) out[n] = [];
  try {
    const pool = await fetchFleetPool();
    if (!Array.isArray(pool) || !pool.length) return out;
    for (const n of names) out[n] = photosFromPool(pool, n);
    return out;
  } catch {
    return out;
  }
}
