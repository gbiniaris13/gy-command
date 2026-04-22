// @ts-nocheck
// Hard-coded posting-window + daily-limit guard for the three IG
// publish crons (feed, fleet yacht, reel).
//
// Why this exists: 2026-04-22 two posts went live at 08:00 and 09:00
// Athens. Dead hours for our UHNW audience — P/CAT ALENA (a fleet
// yacht, prime asset) got 1 like. Roberto locked the posting window
// to 18:00–19:30 Athens and capped feed volume at 1/day with an 18h
// minimum gap. We enforce all of that here so the schedule drift, the
// Telegram approval flow, and any ad-hoc /cron call-sites converge on
// the same rules.
//
// Philosophy: fail CLOSED. If the guard can't figure out whether
// publishing is safe (DB down, clock skew, etc.), block and Telegram
// George rather than posting into the void.

import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

// Hours in 24h Europe/Athens. Window is inclusive-start, exclusive-end
// — 18:00:00 passes, 19:30:00 still passes (we allow up to :30), 20:00
// blocks.
const WINDOW_START_HOUR = 18;
const WINDOW_END_HOUR = 19; // last legal full hour
const WINDOW_END_MINUTE = 30; // + up to this minute
const MIN_GAP_MS = 18 * 60 * 60 * 1000; // 18h between feed posts
const FLEET_YACHT_DAYS = new Set([2, 3, 4]); // Tue, Wed, Thu (JS Date: 0=Sun)
const FEED_WEEKDAYS = new Set([1, 2, 3, 4, 5]); // Mon-Fri per Roberto's brief
const CAROUSEL_DAYS = new Set([1, 4]); // Mon + Thu

export type PostType = "feed" | "fleet_yacht" | "reel" | "carousel";

// Returns hour + minute + day-of-week in Europe/Athens.
export function athensNow(): {
  hour: number;
  minute: number;
  dayOfWeek: number;
  isoDate: string;
} {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const isoDate = `${get("year")}-${get("month")}-${get("day")}`;
  return {
    hour: parseInt(get("hour"), 10) || 0,
    minute: parseInt(get("minute"), 10) || 0,
    dayOfWeek: weekdayMap[get("weekday")] ?? -1,
    isoDate,
  };
}

export function isInWindow(hour: number, minute: number): boolean {
  if (hour < WINDOW_START_HOUR) return false;
  if (hour > WINDOW_END_HOUR) return false;
  if (hour === WINDOW_END_HOUR && minute > WINDOW_END_MINUTE) return false;
  return true;
}

// Start of today in Athens time, as a UTC ISO string (for SQL `>=`
// filters against `published_at TIMESTAMPTZ`).
export function startOfAthensDayIso(): string {
  const { isoDate } = athensNow();
  // Athens is UTC+2 in winter, UTC+3 in summer (DST). Calling
  // `new Date("YYYY-MM-DDT00:00:00+03:00")` only works in summer. A
  // tz-agnostic way: format 00:00 Athens, round-trip through Date.
  const midnightLocal = new Date(isoDate + "T00:00:00");
  // Offset = Athens offset now (minutes east of UTC). DST = 180, std = 120.
  const offsetMinutes = (() => {
    const probe = new Date();
    const athensStr = probe.toLocaleString("en-US", { timeZone: "Europe/Athens" });
    const athensTime = new Date(athensStr);
    return Math.round((athensTime.getTime() - probe.getTime()) / 60000);
  })();
  // midnightLocal is in system-local TZ — normalize by subtracting
  // system offset, then adding Athens offset, to get real UTC millis.
  const sysOffset = -midnightLocal.getTimezoneOffset(); // mins east of UTC
  const utcMs =
    midnightLocal.getTime() - sysOffset * 60000 + offsetMinutes * 60000;
  return new Date(utcMs).toISOString();
}

// The main gate. `postType` controls which daily-limit / weekday rules
// fire. `dryRun` lets routes check the guard without the alert side-
// effect (useful for /dashboard/instagram preview).
export async function assertPublishAllowed({
  postType,
  dryRun = false,
}: {
  postType: PostType;
  dryRun?: boolean;
}): Promise<{ allowed: true } | { allowed: false; reason: string; detail: string }> {
  const { hour, minute, dayOfWeek } = athensNow();

  // Rule 1 — hard window.
  if (!isInWindow(hour, minute)) {
    const detail = `Athens ${hour}:${String(minute).padStart(2, "0")} · window is 18:00–19:30`;
    if (!dryRun) {
      await sendTelegram(
        `⛔ <b>IG post blocked by window guard</b>\n${detail}\nRe-queued to next 18:15 slot.`
      ).catch(() => {});
    }
    return { allowed: false, reason: "outside_window", detail };
  }

  // Rule 2a — fleet yacht only Tue/Wed/Thu (peak B2B days).
  if (postType === "fleet_yacht" && !FLEET_YACHT_DAYS.has(dayOfWeek)) {
    const weekdayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOfWeek] ?? "?";
    const detail = `fleet yacht on ${weekdayName} — only Tue/Wed/Thu are permitted`;
    if (!dryRun) {
      await sendTelegram(
        `⛔ <b>Fleet yacht blocked</b>\n${detail}\nRe-queued to next Tue/Wed/Thu 18:30.`
      ).catch(() => {});
    }
    return { allowed: false, reason: "fleet_yacht_bad_day", detail };
  }

  // Rule 2b — feed + reel only Mon-Fri. No weekend feed posts per brief.
  if ((postType === "feed" || postType === "reel") && !FEED_WEEKDAYS.has(dayOfWeek)) {
    const weekdayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOfWeek] ?? "?";
    const detail = `feed/reel on ${weekdayName} — only Mon-Fri are permitted`;
    if (!dryRun) {
      await sendTelegram(
        `⛔ <b>Weekend feed post blocked</b>\n${detail}\nSat/Sun are story-only per policy.`
      ).catch(() => {});
    }
    return { allowed: false, reason: "weekend_blackout", detail };
  }

  // Rule 2c — carousel only Mon + Thu.
  if (postType === "carousel" && !CAROUSEL_DAYS.has(dayOfWeek)) {
    const weekdayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOfWeek] ?? "?";
    const detail = `carousel on ${weekdayName} — only Mon + Thu are permitted`;
    if (!dryRun) {
      await sendTelegram(
        `⛔ <b>Carousel blocked</b>\n${detail}\nRe-queued to next Mon/Thu.`
      ).catch(() => {});
    }
    return { allowed: false, reason: "carousel_bad_day", detail };
  }

  // Rule 3 — one feed post per Athens day.
  try {
    const sb = createServiceClient();
    const startIso = startOfAthensDayIso();
    const { data } = await sb
      .from("ig_posts")
      .select("id, published_at")
      .eq("status", "published")
      .gte("published_at", startIso);
    const publishedToday = data ?? [];
    if (publishedToday.length >= 1) {
      const detail = `${publishedToday.length} feed post(s) already published today in Athens`;
      if (!dryRun) {
        await sendTelegram(
          `⛔ <b>Second feed post blocked</b>\n${detail}\nDaily limit = 1.`
        ).catch(() => {});
      }
      return { allowed: false, reason: "daily_limit", detail };
    }

    // Rule 4 — minimum 18h gap from last published post (cross-day
    // guard — covers the edge where yesterday's 19:29 + today's 18:00
    // would be only ~22h apart, which is fine, but catches any manual
    // late-night publish that would crowd this morning's slot).
    const { data: recent } = await sb
      .from("ig_posts")
      .select("published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(1);
    const last = recent?.[0]?.published_at;
    if (last) {
      const gapMs = Date.now() - new Date(last).getTime();
      if (gapMs < MIN_GAP_MS) {
        const hoursAgo = (gapMs / (60 * 60 * 1000)).toFixed(1);
        const detail = `last post was ${hoursAgo}h ago · need ≥18h`;
        if (!dryRun) {
          await sendTelegram(
            `⛔ <b>IG post blocked by 18h gap</b>\n${detail}`
          ).catch(() => {});
        }
        return { allowed: false, reason: "gap_too_short", detail };
      }
    }
  } catch (e) {
    // Supabase failure — fail CLOSED.
    const detail = `guard DB check failed: ${String(e).slice(0, 120)}`;
    if (!dryRun) {
      await sendTelegram(`⚠️ <b>IG guard errored, blocking to be safe</b>\n${detail}`).catch(() => {});
    }
    return { allowed: false, reason: "guard_error", detail };
  }

  return { allowed: true };
}
