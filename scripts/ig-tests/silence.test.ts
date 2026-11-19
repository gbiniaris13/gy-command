// Run: node --test scripts/ig-tests/silence.test.ts
// The "feed went quiet" alarm rules (src/lib/ig-silence.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { missedPostingDays, buildSilenceAlert, tallyCauses, athensYmd } from "../../src/lib/ig-silence.ts";

// The watchdog runs at 06:30 UTC.
const morning = (ymd: string) => new Date(`${ymd}T06:30:00Z`);
// Feed posts go out at 18:00 Athens (16:00 UTC winter, 15:00 UTC summer).
const postedWinter = (ymd: string) => `${ymd}T16:02:00Z`;
const postedSummer = (ymd: string) => `${ymd}T15:02:00Z`;

test("healthy: posted yesterday evening, nothing missed this morning", () => {
  assert.deepEqual(missedPostingDays({ lastPublishedAt: postedWinter("2026-11-19"), now: morning("2026-11-20") }), []);
});

test("Sunday is not a posting day: Saturday post, Monday morning is clean", () => {
  assert.deepEqual(missedPostingDays({ lastPublishedAt: postedWinter("2026-11-21"), now: morning("2026-11-23") }), []);
});

test("one missed weekday is reported", () => {
  // Posted Tue 17 Nov, nothing Wed 18, checked Thu 19 morning.
  assert.deepEqual(missedPostingDays({ lastPublishedAt: postedWinter("2026-11-17"), now: morning("2026-11-19") }), ["2026-11-18"]);
});

test("today is never counted, even late in the day", () => {
  assert.deepEqual(
    missedPostingDays({ lastPublishedAt: postedWinter("2026-11-18"), now: new Date("2026-11-19T21:00:00Z") }),
    [],
  );
});

test("a deliberate skip excuses Monday and Saturday only", () => {
  const skipped = new Set(["2026-11-21", "2026-11-25"]); // Sat, Wed
  const missed = missedPostingDays({ lastPublishedAt: postedWinter("2026-11-20"), now: morning("2026-11-27"), skipped });
  // Sat 21 excused, Sun 22 not a posting day, Wed 25 is a fleet day so the skip roll does not excuse it.
  assert.deepEqual(missed, ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"]);
});

test("the real outage: last post Sat 24 Oct, checked Thu 19 Nov = 21 posting days", () => {
  const missed = missedPostingDays({ lastPublishedAt: postedSummer("2026-10-24"), now: morning("2026-11-19") });
  assert.equal(missed.length, 21);
  assert.equal(missed[0], "2026-10-26");
  assert.equal(missed.at(-1), "2026-11-18");
  assert.ok(!missed.includes("2026-10-25") && !missed.includes("2026-11-01"), "Sundays excluded");
});

test("a post published just after midnight UTC still belongs to its Athens date", () => {
  assert.equal(athensYmd(new Date("2026-07-14T22:30:00Z")), "2026-07-15");
});

test("never posted: bounded by the lookback, not infinite", () => {
  const missed = missedPostingDays({ lastPublishedAt: null, now: morning("2026-11-19"), maxLookbackDays: 7 });
  assert.deepEqual(missed, ["2026-11-13", "2026-11-14", "2026-11-16", "2026-11-17", "2026-11-18"]);
});

test("levels: 0 none, 1 notice (Telegram only), 2+ alarm (Telegram and email)", () => {
  const base = { lastPublishedAt: postedWinter("2026-11-16"), now: morning("2026-11-19"), causes: [], queued: 2 };
  assert.equal(buildSilenceAlert({ ...base, missed: [] }).level, "none");
  const one = buildSilenceAlert({ ...base, missed: ["2026-11-18"] });
  assert.equal(one.level, "notice");
  assert.ok(one.telegram.includes("yesterday") && one.subject === "" && one.body === "");
  const two = buildSilenceAlert({ ...base, missed: ["2026-11-17", "2026-11-18"] });
  assert.equal(two.level, "alarm");
  assert.ok(two.telegram.startsWith("🚨") && two.subject.includes("2 posting days") && two.body.includes("Tue 17 Nov, Wed 18 Nov"));
});

test("alarm text carries the cause and the last post date", () => {
  const missed = missedPostingDays({ lastPublishedAt: postedSummer("2026-10-24"), now: morning("2026-11-19") });
  const causes = tallyCauses([
    ...Array(6).fill({ name: "instagram-publish", outcome: "skipped", detail: "window_guard" }),
    ...Array(4).fill({ name: "instagram-fleet-post", outcome: "skipped", detail: "window_guard" }),
    { name: "instagram-generate-weekly", outcome: "error", detail: "approval-gate insert failed" },
    { name: "instagram-publish", outcome: "success" },
  ]);
  assert.deepEqual(causes, [
    "instagram-publish: skipped (window_guard) x6",
    "instagram-fleet-post: skipped (window_guard) x4",
    "instagram-generate-weekly: error (approval-gate insert failed)",
  ]);
  const a = buildSilenceAlert({ missed, lastPublishedAt: postedSummer("2026-10-24"), now: morning("2026-11-19"), causes, queued: 0 });
  assert.ok(a.subject.includes("21 posting days"));
  assert.ok(a.body.includes("Sat 24 Oct (26 days ago)"));
  assert.ok(a.body.includes("Mon 26 Oct to Wed 18 Nov"));
  assert.ok(a.telegram.includes("window_guard"));
  assert.ok(!/[—–]/.test(a.telegram + a.body), "no em or en dashes");
});

test("silence with no recorded cron outcome says so", () => {
  const a = buildSilenceAlert({ missed: ["2026-11-17", "2026-11-18"], lastPublishedAt: null, now: morning("2026-11-19"), causes: [], queued: 0 });
  assert.ok(a.body.includes("may not be firing"));
  assert.ok(a.body.includes("No feed post on record"));
});
