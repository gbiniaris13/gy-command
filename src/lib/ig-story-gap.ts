// The "stories went quiet" check. Pure functions only (no imports), so the
// rules are testable with `node --test scripts/ig-tests/`.
//
// 2026-11-26 (George): from 25 Nov 05:00 UTC to 26 Nov 17:00 UTC no story
// went out. Every run ended "skipped (brand_safety)" on the same yacht, and
// nobody was told: the silence alarm (ig-silence.ts) watched feed posts only.
// George found it by looking at the profile. His words: fully working, no
// lag. So a watch runs 40 minutes after each story slot (05:00, 10:00,
// 17:00 UTC), and when the slot produced nothing it runs the stories job
// once more by itself, then says so.

const HOUR_MS = 3_600_000;

export type StoryGapLevel = "ok" | "retry";

/**
 * "retry" when the slot that just passed produced no story: the last story
 * is older than `slotGraceHours` (the watch runs 40 minutes after a slot;
 * the stories job takes under a minute, plus up to two minutes of jitter).
 */
export function storyGapLevel(opts: { lastStoryAt: string | null; now: Date; slotGraceHours?: number }): StoryGapLevel {
  if (!opts.lastStoryAt) return "retry";
  const age = opts.now.getTime() - new Date(opts.lastStoryAt).getTime();
  return age > (opts.slotGraceHours ?? 1.5) * HOUR_MS ? "retry" : "ok";
}

export type StoryGapReport = {
  /** "fixed": the retry published. "notice": still none, under 12 h. "alarm": 12 h or more without a story. */
  level: "fixed" | "notice" | "alarm";
  telegram: string;
  subject: string;
  body: string;
};

/** What to tell George after a retry. `causes` are the stories job's recent non-success outcomes. */
export function storyGapReport(opts: {
  lastStoryAt: string | null;
  now: Date;
  retryPublished: boolean;
  retryDetail: string;
  causes: string[];
}): StoryGapReport {
  const hours = opts.lastStoryAt
    ? Math.round((opts.now.getTime() - new Date(opts.lastStoryAt).getTime()) / HOUR_MS)
    : null;
  const since = hours === null ? "no story on record" : `last story ${hours} h ago`;
  const why = opts.causes.length ? opts.causes : ["no outcome recorded (the stories job may not be firing at all)"];

  if (opts.retryPublished) {
    return {
      level: "fixed",
      telegram:
        `🔁 <b>Instagram story: the slot produced nothing, so it was run again and a story went out.</b>\n` +
        `Before the retry: ${since}.\nWhy the slot failed: ${why.join("; ")}`,
      subject: "",
      body: "",
    };
  }

  const alarm = hours === null || hours >= 12;
  const head = alarm
    ? `Instagram stories silent: ${hours === null ? "none on record" : `${hours} hours without a story`}`
    : `Instagram story did not go out (${since})`;
  return {
    level: alarm ? "alarm" : "notice",
    telegram:
      `${alarm ? "🚨" : "⚠️"} <b>${head}</b>\n` +
      `A retry was made and failed too: ${opts.retryDetail.slice(0, 200)}\n\n` +
      `<b>Why</b>\n${why.map((c) => `• ${c}`).join("\n")}\n\n` +
      `The next slot will try again${alarm ? ". Forward this to Claude Code to fix." : "."}`,
    subject: alarm ? `🚨 ${head}` : "",
    body: alarm
      ? [
          `${head}.`,
          "",
          `A retry was made and failed too: ${opts.retryDetail.slice(0, 300)}`,
          "",
          "Why (what the stories job reported):",
          ...why.map((c) => `  - ${c}`),
          "",
          "Stories run at 07:00, 12:00 and 19:00 Athens time. This email is sent at most once a day.",
          "To fix: forward this email to Claude Code.",
        ].join("\n")
      : "",
  };
}
