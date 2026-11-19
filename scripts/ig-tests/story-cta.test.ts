// Run: node --test scripts/ig-tests/story-cta.test.ts
// The story call-to-action test (src/lib/story-cta.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  variantForCounter, instagramCta, facebookCta, appendCtaLog, mergeInsights,
  totalsByVariant, ctaReportLines, CTA_LOG_MAX, MIN_STORIES_FOR_VERDICT,
  type CtaLogEntry,
} from "../../src/lib/story-cta.ts";

const entry = (i: number, over: Partial<CtaLogEntry> = {}): CtaLogEntry => ({
  media_id: `m${i}`,
  at: new Date(Date.UTC(2026, 10, 20, 5) + i * 6 * 3600_000).toISOString(),
  variant: variantForCounter(i),
  slot: i % 3 === 0 ? "yacht" : "greece",
  yacht_slug: i % 3 === 0 ? "ad-astra" : null,
  ...over,
});

test("variants alternate with every story", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(variantForCounter), ["bio", "dm", "bio", "dm", "bio", "dm"]);
});

test("over six stories each variant meets the yacht slot once and the Greece slot twice", () => {
  const seen: Record<string, number> = {};
  for (let i = 0; i < 6; i++) {
    const k = `${variantForCounter(i)}/${i % 3 === 0 ? "yacht" : "greece"}`;
    seen[k] = (seen[k] ?? 0) + 1;
  }
  assert.deepEqual(seen, { "bio/yacht": 1, "dm/greece": 2, "bio/greece": 2, "dm/yacht": 1 });
});

test("no Instagram banner promises a tap or shows a web address", () => {
  for (const variant of ["bio", "dm"] as const) {
    for (const yachtName of ["Ad Astra", null]) {
      const c = instagramCta({ variant, yachtName });
      const text = `${c.eyebrow} ${c.main}`.toLowerCase();
      assert.ok(!/\btap\b|swipe|click/.test(text), `"${text}" promises a tap`);
      assert.ok(!/georgeyachts\.com|https?:|www\./.test(text), `"${text}" shows an address`);
      assert.ok(!/[—–]/.test(text), "no dashes");
      assert.ok(c.main.length <= 26, `main line too long: ${c.main}`);
    }
  }
});

test("the DM banner names the yacht; a very long name falls back", () => {
  assert.equal(instagramCta({ variant: "dm", yachtName: "Ad Astra" }).main, 'DM us "AD ASTRA"');
  assert.equal(instagramCta({ variant: "dm", yachtName: "Majesty of Greece" }).main, 'DM us "MAJESTY OF GREECE"');
  assert.equal(instagramCta({ variant: "dm", yachtName: "A Very Long Yacht Name Indeed" }).main, "DM us her name");
  assert.equal(instagramCta({ variant: "dm", yachtName: null }).main, "DM us your dates");
  assert.equal(instagramCta({ variant: "bio", yachtName: "Ad Astra" }).main, "Link in bio");
});

test("Facebook gets the address, never 'link in bio'", () => {
  const c = facebookCta();
  assert.equal(c.main, "georgeyachts.com");
  assert.ok(!/bio/i.test(`${c.eyebrow} ${c.main}`));
});

test("the log replaces a repeated media id and is capped", () => {
  let log: CtaLogEntry[] = [];
  for (let i = 0; i < CTA_LOG_MAX + 30; i++) log = appendCtaLog(log, entry(i));
  assert.equal(log.length, CTA_LOG_MAX);
  assert.equal(log[0].media_id, "m30");
  const again = appendCtaLog(log, entry(CTA_LOG_MAX + 29, { variant: "bio" }));
  assert.equal(again.length, CTA_LOG_MAX);
  assert.equal(again.filter((e) => e.media_id === `m${CTA_LOG_MAX + 29}`).length, 1);
});

test("insights only ever grow: a partial or lower reading erases nothing", () => {
  let log = [entry(0)];
  ({ log } = mergeInsights(log, "m0", { reach: 120, replies: 2, profile_visits: 5, fetched_at: "t1" }));
  const r = mergeInsights(log, "m0", { reach: 90, replies: 3, fetched_at: "t2" });
  assert.equal(r.matched, true);
  assert.deepEqual(r.log[0].insights, { reach: 120, replies: 3, profile_visits: 5, fetched_at: "t2" });
  assert.equal(mergeInsights(log, "unknown", { reach: 1 }).matched, false);
});

test("totals compare the variants per 1,000 reached", () => {
  let log = [entry(0), entry(1), entry(2), entry(3)];
  ({ log } = mergeInsights(log, "m0", { reach: 200, replies: 0, profile_visits: 6 })); // bio
  ({ log } = mergeInsights(log, "m1", { reach: 100, replies: 2, profile_visits: 1 })); // dm
  ({ log } = mergeInsights(log, "m2", { reach: 300, replies: 1, profile_visits: 9 })); // bio
  const [bio, dm] = totalsByVariant(log);
  assert.deepEqual(
    { s: bio.stories, m: bio.measured, reach: bio.reach, pv: bio.profile_visits, pv1k: bio.profile_visits_per_1000, r1k: bio.replies_per_1000 },
    { s: 2, m: 2, reach: 500, pv: 15, pv1k: 30, r1k: 2 },
  );
  assert.deepEqual({ s: dm.stories, m: dm.measured, reach: dm.reach, r1k: dm.replies_per_1000 }, { s: 2, m: 1, reach: 100, r1k: 20 });
});

test("the report says nothing before the test starts and refuses a verdict too early", () => {
  assert.deepEqual(ctaReportLines({ log: [], bioLinkSessions7d: 3 }), []);
  let log = [entry(0), entry(1)];
  ({ log } = mergeInsights(log, "m0", { reach: 100, replies: 0, profile_visits: 2 }));
  const early = ctaReportLines({ log, bioLinkSessions7d: 4 }).join("\n");
  assert.ok(early.includes("Too early to call"));
  assert.ok(early.includes("Site visits from the bio link, last 7 days: 4"));
  assert.ok(early.includes("n/a"), "a variant with no reach shows n/a, not a made-up rate");
  let big: CtaLogEntry[] = [];
  for (let i = 0; i < MIN_STORIES_FOR_VERDICT * 2; i++) {
    big = appendCtaLog(big, entry(i));
    ({ log: big } = mergeInsights(big, `m${i}`, { reach: 100, replies: 1, profile_visits: 1 }));
  }
  assert.ok(ctaReportLines({ log: big, bioLinkSessions7d: null }).join("\n").includes("enough stories to compare"));
});
