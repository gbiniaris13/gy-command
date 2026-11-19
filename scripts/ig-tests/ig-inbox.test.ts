// node --test scripts/ig-tests/ig-inbox.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { isAthensNight, nextNineAthens, awayNote, keywordIn, privateReply, hasWords, KEYWORDS } from "../../src/lib/ig-inbox.ts";
import { GUIDE_DECKS, SHORTLIST_SPECS } from "../../src/lib/guide-decks.ts";

test("night in Athens is midnight to eight, winter and summer", () => {
  // Winter: Athens = UTC+2.
  assert.equal(isAthensNight(new Date("2026-11-19T22:30:00Z")), true, "00:30 Athens");
  assert.equal(isAthensNight(new Date("2026-11-20T05:59:00Z")), true, "07:59 Athens");
  assert.equal(isAthensNight(new Date("2026-11-20T06:00:00Z")), false, "08:00 Athens");
  assert.equal(isAthensNight(new Date("2026-11-19T21:59:00Z")), false, "23:59 Athens");
  // Summer: Athens = UTC+3.
  assert.equal(isAthensNight(new Date("2026-07-10T21:30:00Z")), true, "00:30 Athens");
  assert.equal(isAthensNight(new Date("2026-07-10T05:00:00Z")), false, "08:00 Athens");
});

test("the promise is the next 09:00 in Athens, told in New York time too", () => {
  assert.equal(nextNineAthens(new Date("2026-11-19T23:10:00Z")).toISOString(), "2026-11-20T07:00:00.000Z");
  assert.equal(nextNineAthens(new Date("2026-07-10T22:00:00Z")).toISOString(), "2026-07-11T06:00:00.000Z");
  const winter = awayNote(new Date("2026-11-19T23:10:00Z"));
  assert.match(winter, /by 09:00 Athens time \(2:00 AM in New York\)/);
  // The week in March when the US has changed its clocks and Greece has not: six hours apart.
  const march = awayNote(new Date("2026-03-16T23:10:00Z"));
  assert.match(march, /by 09:00 Athens time \(3:00 AM in New York\)/);
});

test("the night note says what it is, is signed, and promises nothing it cannot keep", () => {
  const n = awayNote(new Date("2026-11-19T23:10:00Z"));
  assert.match(n, /This is an automatic note/);
  assert.match(n, /I am George/);
  assert.ok(n.endsWith("George P. Biniaris"));
  assert.ok(!/[–—]/.test(n), "no dashes");
  assert.ok(!/\b(we|our|team)\b/i.test(n), "one person, not a team");
  assert.ok(!/calendly|book a call|http/i.test(n), "no booking link, no menu");
  assert.ok((n.match(/\?/g) ?? []).length === 0 && /dates, the number of guests and a rough budget/.test(n), "three things asked, as one request");
  assert.ok(n.length < 500);
});

test("a keyword is a comment that is little more than the word", () => {
  assert.equal(keywordIn("COST"), "COST");
  assert.equal(keywordIn("cost please"), "COST");
  assert.equal(keywordIn("Ten!"), "TEN");
  assert.equal(keywordIn("send me cost"), "COST");
  assert.equal(keywordIn("  apa  "), "APA");
  assert.equal(keywordIn("What does it cost for ten people in July?"), null, "a sentence is a person talking");
  assert.equal(keywordIn("cost ten"), null, "two keywords is not a request for one thing");
  assert.equal(keywordIn("beautiful"), null);
  assert.equal(keywordIn("🔥🔥"), null);
  assert.equal(keywordIn(""), null);
});

test("every word a post asks for has an answer ready", () => {
  const asked = new Set([...GUIDE_DECKS.map((d) => d.keyword), ...SHORTLIST_SPECS.map((s) => s.keyword)]);
  for (const k of asked) assert.ok(k in KEYWORDS, `${k} has a private reply`);
  for (const k of Object.keys(KEYWORDS)) {
    const r = privateReply(k)!;
    assert.match(r, /This is an automatic note/);
    assert.ok(r.endsWith("George P. Biniaris"));
    assert.match(r, /georgeyachts\.com\//);
    assert.ok(!/[–—]/.test(r) && !/\b(we|our|team)\b/i.test(r));
    assert.ok(r.length < 1000, "Instagram's limit for a message");
  }
  assert.equal(privateReply("NOPE"), null);
});

test("emoji alone is not worth a ping, words are", () => {
  assert.equal(hasWords("🔥🔥🔥"), false);
  assert.equal(hasWords("👏 !!"), false);
  assert.equal(hasWords("How many cabins?"), true);
  assert.equal(hasWords("Όμορφο"), true);
});
