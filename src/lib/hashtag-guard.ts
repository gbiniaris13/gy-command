// @ts-nocheck
/**
 * Banned hashtag guard.
 *
 * Roberto brief v3 — Phase 0.75, Guard 4.
 *
 * Every caption-publishing cron runs the final caption text through
 * `stripBannedHashtags` before posting. If any banned hashtag slipped in
 * (Gemini occasionally grabs #followforfollow-style spam tags when
 * prompting for "luxury travel hashtags"), we remove it from the
 * caption text and log the strip so the weekly health check can
 * surface repeated AI offenses.
 *
 * Blocklist lives in `settings.banned_hashtags` as a JSON string array.
 * Seeded by `seedBannedHashtags()` on first ever call — George or the
 * marketing team can edit the list through the dashboard later without
 * a redeploy.
 *
 * This is additive. If the settings row is missing or corrupt, the
 * function returns the caption unchanged (fail-open) so no cron ever
 * breaks because of a blocklist issue.
 */

import { createServiceClient } from "./supabase-server";

const SETTINGS_KEY = "banned_hashtags";

// Seed list — based on the brief's Feb 2026 shadowban-trigger research
// (Later, Hopper HQ public trackers). The dashboard can edit this list
// anytime; the seed just populates an empty settings row on first run.
const SEED_BANNED_HASHTAGS = [
  // Engagement bait / follow scams — instant shadowban signal
  "#followforfollow",
  "#f4f",
  "#likeforlike",
  "#l4l",
  "#followme",
  "#tagforlikes",
  "#tag4tag",
  // Innocuously named but flagged by Meta as spam hotspots
  "#alone",
  "#brain",
  "#pushups",
  "#snapchat",
  "#saintpatricksday",
  "#costumes",
  "#kissing",
  // Known mid-2025 rolling blocklist additions
  "#petite",
  "#models",
  "#mustfollow",
  "#likesforlikes",
];

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Runs the caption through the blocklist, returns the cleaned caption
 * plus the list of hashtags that were stripped. Callers should use the
 * cleaned caption when publishing.
 *
 *   const { cleaned, stripped } = await stripBannedHashtags(caption);
 *   if (stripped.length > 0) console.warn("Stripped:", stripped);
 */
export async function stripBannedHashtags(caption: string): Promise<{
  cleaned: string;
  stripped: string[];
}> {
  if (!caption || typeof caption !== "string") {
    return { cleaned: caption, stripped: [] };
  }

  const blocklist = await loadBlocklist();
  if (blocklist.length === 0) return { cleaned: caption, stripped: [] };

  const stripped: string[] = [];
  let cleaned = caption;
  for (const tag of blocklist) {
    // Case-insensitive, whole-token match. \b isn't reliable around #
    // because # is a non-word boundary, so we check whitespace / start /
    // end around the token manually via regex.
    const pattern = new RegExp(
      `(^|[\\s\\p{P}])${escapeRegex(tag)}(?=$|[\\s\\p{P}])`,
      "giu",
    );
    if (pattern.test(cleaned)) {
      stripped.push(tag);
      cleaned = cleaned.replace(pattern, (_match, leading) => leading ?? "");
    }
  }
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ").trim();
  return { cleaned, stripped };
}

/**
 * One-time seed on first deploy. Idempotent — calling multiple times
 * is a no-op once the row exists. Exposed so the Phase A deploy can
 * call it from a startup path or an admin endpoint.
 */
export async function seedBannedHashtags(): Promise<void> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("settings")
    .select("key")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (data) return;
  await sb.from("settings").insert({
    key: SETTINGS_KEY,
    value: JSON.stringify(SEED_BANNED_HASHTAGS),
    updated_at: new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

async function loadBlocklist(): Promise<string[]> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();

  // Self-seed on first ever call — no manual admin step needed.
  if (!data) {
    await seedBannedHashtags().catch(() => {});
    return SEED_BANNED_HASHTAGS.map((x) => x.toLowerCase());
  }
  if (!data.value) return [];
  try {
    const parsed = JSON.parse(data.value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => typeof x === "string")
      .map((x) => x.toLowerCase().trim())
      .filter((x) => x.startsWith("#"));
  } catch {
    return [];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
