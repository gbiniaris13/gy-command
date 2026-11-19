// The "feed went quiet" alarm. Pure functions only (no imports), so the
// rules are testable with `node --test scripts/ig-tests/`.
//
// 2026-11-19 (George). The feed was silent from 24 October to 19 November
// and nobody noticed: the watchdog tried to regenerate posts, got nothing
// back, and said nothing. The window guard did post "blocked" notes to
// Telegram every day, but a daily note that looks like routine is not an
// alarm. This module answers one question every morning: on which days
// should a feed post have gone out since the last one, and did not?
//
// A posting day is Monday to Saturday in Athens (Sunday is stories only).
// A Monday or Saturday the publisher deliberately skipped (the stealth
// roll in meta-stealth.ts) is excused; Tuesday to Friday belongs to the
// fleet post, which never skips on purpose.

const DAY_MS = 86_400_000;

/** Calendar date in Athens, YYYY-MM-DD. */
export function athensYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(d);
}

/** 0 = Sunday ... 6 = Saturday, for a YYYY-MM-DD calendar date. */
function dow(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

function nextDay(ymd: string): string {
  return new Date(new Date(`${ymd}T12:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);
}

/**
 * Athens dates, oldest first, strictly after the last published post and
 * strictly before today, on which a feed post was due and none went out.
 * Today is never counted: the post goes out in the evening and the
 * watchdog runs in the morning.
 */
export function missedPostingDays(opts: {
  lastPublishedAt: string | null;
  now: Date;
  /** Athens dates the publisher skipped on purpose (stealth roll). */
  skipped?: Set<string>;
  /** How far back to look when there has never been a post. */
  maxLookbackDays?: number;
}): string[] {
  const today = athensYmd(opts.now);
  const lookback = opts.maxLookbackDays ?? 45;
  const floor = athensYmd(new Date(opts.now.getTime() - lookback * DAY_MS));
  let last = opts.lastPublishedAt ? athensYmd(new Date(opts.lastPublishedAt)) : floor;
  if (last < floor) last = floor;

  const missed: string[] = [];
  for (let d = nextDay(last); d < today; d = nextDay(d)) {
    const wd = dow(d);
    if (wd === 0) continue; // Sunday: stories only
    if ((wd === 1 || wd === 6) && opts.skipped?.has(d)) continue; // deliberate skip
    missed.push(d);
  }
  return missed;
}

export type SilenceLevel = "none" | "notice" | "alarm";

export type SilenceAlert = {
  level: SilenceLevel;
  missed: string[];
  /** Telegram HTML. Empty when level is "none". */
  telegram: string;
  /** Email subject and plain-text body. Empty unless level is "alarm". */
  subject: string;
  body: string;
};

function prettyDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * One missed posting day is a notice (Telegram only). Two or more is an
 * alarm (Telegram and email), repeated every morning until a post goes
 * out. `causes` are the non-success outcomes of the feed crons over the
 * silent stretch, already tallied by the caller.
 */
export function buildSilenceAlert(opts: {
  missed: string[];
  lastPublishedAt: string | null;
  now: Date;
  causes: string[];
  queued: number;
}): SilenceAlert {
  const n = opts.missed.length;
  if (n === 0) return { level: "none", missed: [], telegram: "", subject: "", body: "" };

  const lastYmd = opts.lastPublishedAt ? athensYmd(new Date(opts.lastPublishedAt)) : null;
  const lastLine = lastYmd
    ? `Last feed post: ${prettyDate(lastYmd)} (${Math.round(
        (new Date(`${athensYmd(opts.now)}T12:00:00Z`).getTime() -
          new Date(`${lastYmd}T12:00:00Z`).getTime()) /
          DAY_MS,
      )} days ago)`
    : "No feed post on record";
  const missedLine =
    n <= 4
      ? opts.missed.map(prettyDate).join(", ")
      : `${prettyDate(opts.missed[0])} to ${prettyDate(opts.missed[n - 1])}`;
  const causeLines = opts.causes.length ? opts.causes : ["no cron outcome recorded (the crons may not be firing at all)"];
  const queueLine = `Posts queued for the next 7 days: ${opts.queued}`;

  if (n === 1) {
    return {
      level: "notice",
      missed: opts.missed,
      telegram:
        `⚠️ <b>Instagram: yesterday's feed post did not go out</b>\n` +
        `Missed: ${missedLine}\n${lastLine}\n` +
        `Why: ${causeLines.join("; ")}\n${queueLine}\n` +
        `If tomorrow is missed too, this becomes an alarm.`,
      subject: "",
      body: "",
    };
  }

  const head = `Instagram feed silent: ${n} posting days missed`;
  return {
    level: "alarm",
    missed: opts.missed,
    telegram:
      `🚨 <b>${head}</b>\n` +
      `Missed: ${missedLine}\n${lastLine}\n\n` +
      `<b>Why</b>\n${causeLines.map((c) => `• ${c}`).join("\n")}\n\n` +
      `${queueLine}\n` +
      `This repeats every morning until a post goes out. Forward it to Claude Code to fix.`,
    subject: `🚨 ${head}`,
    body: [
      `${head}.`,
      "",
      `Missed: ${missedLine}`,
      lastLine,
      "",
      "Why (what the feed crons reported):",
      ...causeLines.map((c) => `  - ${c}`),
      "",
      queueLine,
      "",
      "This alarm covers feed posts only. Stories are not checked here and may still be running.",
      "This email repeats every morning until a feed post goes out.",
      "To fix: forward this email to Claude Code.",
    ].join("\n"),
  };
}

/** Tallies cron outcomes into lines like "instagram-publish: skipped (window_guard) x6". */
export function tallyCauses(
  runs: Array<{ name: string; outcome: string; detail?: string | null }>,
): string[] {
  const counts = new Map<string, number>();
  for (const r of runs) {
    if (r.outcome === "success") continue;
    const key = `${r.name}: ${r.outcome}${r.detail ? ` (${r.detail})` : ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, c]) => (c > 1 ? `${k} x${c}` : k));
}
