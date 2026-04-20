// @ts-nocheck
/**
 * Fleet post rotation — yacht + angle selection with cooldowns.
 *
 * Phase D.1 rules:
 *   - Yacht-level cooldown: 14 days between repeat posts of the same yacht.
 *     If all yachts are on cooldown (small fleet edge case), pick the
 *     least-recently-posted.
 *   - Back-to-back guard: never pick the literal previous yacht, even
 *     if cooldown would allow it.
 *   - Per-angle eligibility: each angle has a checker that runs
 *     against yacht fields before it's added to the eligible set.
 *     A yacht stays in the pool even if one angle is weak — we just
 *     skip that angle and pick from the rest.
 *   - Angle rotation per yacht: exclude the 2 most-recently-used
 *     angles for this specific yacht so we don't repeat a framing
 *     back-to-back when it returns from cooldown.
 *
 * Rotation state in settings KV (zero DDL):
 *   key: `fleet_rotation_v1`
 *   value: JSON {
 *     byYacht: { [yachtId]: { lastPostedAt: iso, angleHistory: [angle, ...] } },
 *     lastYachtId: id | null
 *   }
 */

import { createServiceClient } from "./supabase-server";
import type { FleetYacht } from "./sanity-fleet";

export const FLEET_ANGLES = [
  "inside_info",
  "ideal_guest",
  "toys_tour",
  "builder_heritage",
  "cruising_canvas",
  "crew_spotlight",
] as const;
export type FleetAngle = (typeof FLEET_ANGLES)[number];

const ROTATION_KEY = "fleet_rotation_v1";
const COOLDOWN_DAYS = 14;

type RotationState = {
  byYacht: Record<
    string,
    { lastPostedAt: string; angleHistory: FleetAngle[] }
  >;
  lastYachtId: string | null;
};

// ─────────────────────────────────────────────────────────────────────
// Per-angle eligibility
// ─────────────────────────────────────────────────────────────────────

/**
 * Decide whether a given angle can be used for a given yacht based on
 * what fields are populated. Keeps a yacht in the rotation pool even
 * when only some of its angles are viable.
 */
export function angleEligibleForYacht(
  yacht: FleetYacht,
  angle: FleetAngle,
): { eligible: boolean; reason?: string } {
  switch (angle) {
    case "inside_info": {
      const len = (yacht.georgeInsiderTip ?? "").trim().length;
      return len >= 200
        ? { eligible: true }
        : {
            eligible: false,
            reason: `georgeInsiderTip too short (${len} chars, need 200)`,
          };
    }
    case "ideal_guest": {
      const len = (yacht.idealFor ?? "").trim().length;
      return len >= 40
        ? { eligible: true }
        : { eligible: false, reason: `idealFor too short (${len} chars)` };
    }
    case "toys_tour": {
      const count = (yacht.toys ?? []).length;
      return count >= 4
        ? { eligible: true }
        : { eligible: false, reason: `only ${count} toys (need 4)` };
    }
    case "builder_heritage": {
      const hasBuilder = !!(yacht.builder && yacht.builder.trim().length > 2);
      const hasYear = !!(yacht.yearBuiltRefit && yacht.yearBuiltRefit.trim().length > 2);
      return hasBuilder && hasYear
        ? { eligible: true }
        : { eligible: false, reason: "missing builder or yearBuiltRefit" };
    }
    case "cruising_canvas": {
      const len = (yacht.cruisingRegion ?? "").trim().length;
      return len >= 4
        ? { eligible: true }
        : { eligible: false, reason: "no cruisingRegion" };
    }
    case "crew_spotlight": {
      // Rich crew string with at least a captain name and some context.
      // Weak crew strings like "3" or "Captain, Chef, Stewardess" don't
      // carry enough story to anchor a post.
      const crew = (yacht.crew ?? "").trim();
      const hasName = /captain\s+[A-Z][a-z]/.test(crew);
      return crew.length >= 60 && hasName
        ? { eligible: true }
        : {
            eligible: false,
            reason: "crew string lacks a named captain / bio",
          };
    }
    default:
      return { eligible: false, reason: "unknown angle" };
  }
}

export function eligibleAnglesForYacht(yacht: FleetYacht): FleetAngle[] {
  return FLEET_ANGLES.filter((a) => angleEligibleForYacht(yacht, a).eligible);
}

// ─────────────────────────────────────────────────────────────────────
// Yacht selection
// ─────────────────────────────────────────────────────────────────────

export async function loadRotationState(): Promise<RotationState> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", ROTATION_KEY)
    .maybeSingle();
  if (!data?.value) return { byYacht: {}, lastYachtId: null };
  try {
    const parsed = JSON.parse(data.value);
    return {
      byYacht: parsed?.byYacht ?? {},
      lastYachtId: parsed?.lastYachtId ?? null,
    };
  } catch {
    return { byYacht: {}, lastYachtId: null };
  }
}

export async function persistRotationState(state: RotationState): Promise<void> {
  const sb = createServiceClient();
  await sb
    .from("settings")
    .upsert(
      {
        key: ROTATION_KEY,
        value: JSON.stringify(state),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    )
    .catch(() => {});
}

/**
 * Pick the next yacht to feature. Returns null if the pool is empty
 * OR if every yacht has zero eligible angles.
 */
export function selectNextYacht(
  pool: FleetYacht[],
  state: RotationState,
): FleetYacht | null {
  if (!pool || pool.length === 0) return null;

  const now = Date.now();
  const cooldownMs = COOLDOWN_DAYS * 86400000;

  // Only consider yachts that have at least one eligible angle.
  const usable = pool.filter((y) => eligibleAnglesForYacht(y).length > 0);
  if (usable.length === 0) return null;

  // Split into never-posted vs posted.
  const neverPosted = usable.filter((y) => !state.byYacht[y._id]);
  const posted = usable
    .filter((y) => state.byYacht[y._id])
    .map((y) => ({
      y,
      lastMs: new Date(state.byYacht[y._id].lastPostedAt).getTime(),
    }));

  // Preferred pool = never-posted first (brand new discoverability),
  // then posted-but-off-cooldown sorted LRU (oldest first).
  const offCooldown = posted
    .filter((p) => now - p.lastMs >= cooldownMs)
    .sort((a, b) => a.lastMs - b.lastMs)
    .map((p) => p.y);

  let pool1 = neverPosted.length > 0 ? neverPosted : offCooldown;

  // All yachts on cooldown? Fall back to LRU across the whole posted set.
  if (pool1.length === 0) {
    pool1 = posted.sort((a, b) => a.lastMs - b.lastMs).map((p) => p.y);
  }

  // Back-to-back guard.
  if (state.lastYachtId && pool1.length > 1) {
    pool1 = pool1.filter((y) => y._id !== state.lastYachtId);
  }

  if (pool1.length === 0) return null;
  // Slight randomness in the top slice so the sequence doesn't lock
  // into a deterministic pattern when many never-posted yachts are tied.
  const topSlice = pool1.slice(0, Math.min(5, pool1.length));
  return topSlice[Math.floor(Math.random() * topSlice.length)];
}

/**
 * Pick an angle for the chosen yacht, excluding the last 2 angles used
 * for this yacht (avoid repeating framing when it returns from cooldown).
 * Falls back to any eligible angle if the exclusion empties the pool.
 */
export function selectAngle(
  yacht: FleetYacht,
  state: RotationState,
): FleetAngle | null {
  const eligible = eligibleAnglesForYacht(yacht);
  if (eligible.length === 0) return null;

  const history = state.byYacht[yacht._id]?.angleHistory ?? [];
  const recent = new Set(history.slice(-2));
  let candidates = eligible.filter((a) => !recent.has(a));
  if (candidates.length === 0) candidates = eligible;

  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Record a successful fleet post in the rotation state.
 * Caps angleHistory to last 10 entries per yacht so the blob stays small.
 */
export function updateStateAfterPost(
  state: RotationState,
  yachtId: string,
  angle: FleetAngle,
): RotationState {
  const existing = state.byYacht[yachtId] ?? {
    lastPostedAt: "",
    angleHistory: [] as FleetAngle[],
  };
  const nextHistory = [...existing.angleHistory, angle].slice(-10);
  return {
    byYacht: {
      ...state.byYacht,
      [yachtId]: {
        lastPostedAt: new Date().toISOString(),
        angleHistory: nextHistory,
      },
    },
    lastYachtId: yachtId,
  };
}
