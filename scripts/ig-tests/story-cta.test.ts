// Run: node --test scripts/ig-tests/story-cta.test.ts
// The story call-to-action test (src/lib/story-cta.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  variantForCounter, instagramCta, facebookCta, appendCtaLog, mergeInsights,
  totalsByVariant, ctaReportLines, CTA_LOG_MAX,
  type CtaLogEntry,
} from "../../src/lib/story-cta.ts";

const entry = (i: number, over: Partial<CtaLogEntry> = {}): CtaLogEntry => ({
  media_id: `m${i}`,
  at: new Date(Date.UTC(2026, 10, 20, 5) + i * 6 * 3600_000).toISOString(),
  // The log still holds stories from the two days both banners ran.
  variant: i % 2 === 0 ? "bio" : "dm",
  slot: i % 3 === 0 ? "yacht" : "greece",
  yacht_slug: i % 3 === 0 ? "ad-astra" : null,
  ...over,
});

test("every story asks for a message: 'Link in bio' is retired", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(variantForCounter), ["dm", "dm", "dm", "dm", "dm", "dm"]);
  for (const variant of ["bio", "dm", undefined] as const) {
    assert.ok(!/bio/i.test(instagramCta({ variant, yachtName: "Ad Astra" }).main), "no banner says 'link in bio'");
    assert.equal(instagramCta({ variant, yachtName: null }).icon, "none", "no link glyph: nothing may look like a button to a link");
  }
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

test("the banner names the yacht, in the house's voice; a very long name falls back", () => {
  assert.equal(instagramCta({ yachtName: "Ad Astra" }).main, 'Message us "AD ASTRA"');
  assert.equal(instagramCta({ yachtName: "Majesty of Greece" }).main, 'Message us "MAJESTY OF GREECE"');
  assert.equal(instagramCta({ yachtName: "A Very Long Yacht Name Indeed" }).main, "Message us her name");
  assert.equal(instagramCta({ yachtName: null }).main, "Message us your dates");
  assert.equal(instagramCta({ yachtName: "S/CAT Ad Astra" }).main, 'Message us "AD ASTRA"', "no catalogue prefix");
  assert.equal(instagramCta({ yachtName: "Ad Astra" }).eyebrow, "Dates and rates on request");
  for (const y of ["Majesty of Greece", "ChristAl MiO 80", "Can't Remember", "A Name Of Eighteen!"]) {
    assert.ok(instagramCta({ yachtName: y }).main.length <= 30, "fits the banner");
  }
  for (const y of ["Ad Astra", null]) {
    const c = instagramCta({ yachtName: y });
    assert.ok(!/\b(me|my|I)\b/.test(`${c.eyebrow} ${c.main}`), "the profile speaks as the house");
  }
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

test("the report says nothing with no stories, and says why 'Link in bio' stopped", () => {
  assert.deepEqual(ctaReportLines({ log: [], bioLinkSessions7d: 3 }), []);
  let log = [entry(0), entry(1)];
  ({ log } = mergeInsights(log, "m0", { reach: 100, replies: 0, profile_visits: 2 }));
  const early = ctaReportLines({ log, bioLinkSessions7d: 4 }).join("\n");
  assert.ok(early.includes("retired on 20 November"));
  assert.ok(early.includes("Link in bio (retired 20 Nov): 1 stories") && early.includes("Message us: 1 stories"));
  assert.ok(early.includes("Site visits from the bio link, last 7 days: 4"));
  assert.ok(early.includes("n/a"), "a variant with no reach shows n/a, not a made-up rate");
  const onlyDm = ctaReportLines({ log: [entry(1)], bioLinkSessions7d: null }).join("\n");
  assert.ok(!onlyDm.includes("Link in bio (retired 20 Nov):"), "a banner with no stories gets no line");
});
