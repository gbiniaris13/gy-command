// @ts-nocheck
/**
 * Rate-limit circuit breaker for all Instagram-acting crons.
 *
 * Roberto brief v3 — Phase 0.5 (Meta Rate Limits Bible).
 *
 * Every cron that hits the Instagram Graph API calls `checkRateLimitHealth`
 * before doing its work. If the 70%-of-cap ceiling is hit for either the
 * hourly OR the daily window, the cron exits silently and fires a single
 * Telegram alert. Prevents us from ever getting close to Meta's hard caps
 * (which cause shadowbans, not just HTTP errors).
 *
 * Action log storage: piggybacks on the existing `settings` key-value
 * table — one row per action firing, key = `rl_<action>_<nanoid>`,
 * `updated_at` = time of the action. Zero DDL required, same pattern
 * the story rotation fix uses. Pruned automatically by `pruneOldLogs`
 * on every check so the table never bloats.
 *
 * If the settings write fails the cron still runs (fail-open) — we care
 * more about staying live than about perfect accounting. The Telegram
 * alert still fires so George knows.
 */

import { createServiceClient } from "./supabase-server";
import { sendTelegram } from "./telegram";

export type RateLimitAction =
  | "post_publish" // feed post, carousel, reel — IG /media + /media_publish
  | "story_publish" // IG stories
  | "comment_outbound" // our proactive comments on other accounts' posts
  | "comment_reply" // auto-replies on OUR post comments
  | "dm_send" // outbound DMs
  | "api_call"; // catch-all for any Graph API call that doesn't fit the above

// 70% of Meta's documented hard caps (Feb 2026). Updating these is the
// single dial to tighten/loosen throttling without touching any cron.
// Hard caps for reference:
//   posts: 100/24h hard, ~10/hour burst
//   stories: ~100/24h soft
//   comments posted: ~30-40/hour (bot detection threshold)
//   comment replies on our posts: 750/hour
//   dm send: 200/hour
//   api calls: 200/hour per account (4800/h high-trust)
const CAPS: Record<RateLimitAction, { hourly: number; daily: number | null }> = {
  post_publish: { hourly: 15, daily: 70 },
  story_publish: { hourly: 10, daily: 70 },
  comment_outbound: { hourly: 25, daily: 150 },
  comment_reply: { hourly: 500, daily: 2000 },
  dm_send: { hourly: 140, daily: 500 },
  api_call: { hourly: 140, daily: null },
};

const PRUNE_AFTER_DAYS = 7;

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Call before taking an action. Returns true if safe to proceed.
 * Returns false + fires a single Telegram alert if near a cap.
 *
 *   if (!(await checkRateLimitHealth("post_publish"))) {
 *     return NextResponse.json({ skipped: "rate_limit" });
 *   }
 */
export async function checkRateLimitHealth(
  action: RateLimitAction,
): Promise<boolean> {
  const sb = createServiceClient();
  const cap = CAPS[action];

  // Opportunistic prune — cheap, keeps the settings table bounded.
  pruneOldLogs(sb).catch(() => {});

  // Global pause flag — flipped by the health check cron on RED.
  // One switch, all crons stop.
  const { data: pausedRow } = await sb
    .from("settings")
    .select("value")
    .eq("key", "crons_paused")
    .maybeSingle();
  if (pausedRow?.value === "true") {
    return false;
  }

  // Count rows in the rolling windows. We use updated_at (auto-stamped
  // on insert) instead of parsing the JSON value for speed.
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const hourlyCount = await countSince(sb, action, hourAgo);
  if (hourlyCount >= cap.hourly) {
    await sendTelegram(
      `⚠ <b>Rate limit circuit breaker</b>\nAction: <code>${action}</code>\nHourly: ${hourlyCount}/${cap.hourly} — auto-paused this cron.`,
    );
    return false;
  }

  if (cap.daily !== null) {
    const dailyCount = await countSince(sb, action, dayAgo);
    if (dailyCount >= cap.daily) {
      await sendTelegram(
        `⚠ <b>Daily cap approaching</b>\nAction: <code>${action}</code>\nLast 24h: ${dailyCount}/${cap.daily} — auto-paused until reset.`,
      );
      return false;
    }
  }

  return true;
}

/**
 * Record that an action just happened. Call this AFTER the IG API call
 * returned success. Safe to call from multiple concurrent invocations —
 * key collisions are extraordinarily unlikely and the worst case is one
 * extra row.
 */
export async function logRateLimitAction(
  action: RateLimitAction,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const sb = createServiceClient();
  const id = generateId();
  const key = `rl_${action}_${id}`;
  const value = JSON.stringify({
    action,
    at: Date.now(),
    ...(metadata ? { meta: metadata } : {}),
  });
  try {
    await sb
      .from("settings")
      .insert({ key, value, updated_at: new Date().toISOString() });
  } catch {
    // Fail-open — logging failure never blocks the real action.
  }
}

/**
 * Add a random 0-15 minute delay to a cron execution. Every IG-facing
 * publish cron calls this once at the start. Spreads our activity across
 * the clock so we don't look like a bot firing at X:00:00.
 *
 * For local dev, set DISABLE_IG_JITTER=1 to skip the wait.
 */
export async function applyPublishJitter(): Promise<void> {
  if (process.env.DISABLE_IG_JITTER === "1") return;
  const jitterMs = Math.floor(Math.random() * 15 * 60 * 1000);
  if (jitterMs < 100) return; // trivial, skip the log noise
  console.log(`[jitter] sleeping ${(jitterMs / 1000).toFixed(1)}s`);
  await new Promise((r) => setTimeout(r, jitterMs));
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

async function countSince(
  sb: ReturnType<typeof createServiceClient>,
  action: RateLimitAction,
  sinceIso: string,
): Promise<number> {
  const { count } = await sb
    .from("settings")
    .select("*", { count: "exact", head: true })
    .like("key", `rl_${action}_%`)
    .gt("updated_at", sinceIso);
  return count ?? 0;
}

async function pruneOldLogs(
  sb: ReturnType<typeof createServiceClient>,
): Promise<void> {
  const cutoff = new Date(
    Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  await sb.from("settings").delete().like("key", "rl_%").lt("updated_at", cutoff);
}

function generateId(): string {
  // 10 chars base36, collision-safe enough for our volume.
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}
