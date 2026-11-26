// Run: node --test scripts/ig-tests/story-gap.test.ts
// The "stories went quiet" rules (src/lib/ig-story-gap.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { storyGapLevel, storyGapReport } from "../../src/lib/ig-story-gap.ts";

test("a story from the slot that just passed is fine", () => {
  assert.equal(storyGapLevel({ lastStoryAt: "2026-11-26T17:00:40Z", now: new Date("2026-11-26T17:40:00Z") }), "ok");
});

test("the slot produced nothing: the previous story is from the slot before", () => {
  assert.equal(storyGapLevel({ lastStoryAt: "2026-11-26T10:00:30Z", now: new Date("2026-11-26T17:40:00Z") }), "retry");
});

test("no story on record is a retry", () => {
  assert.equal(storyGapLevel({ lastStoryAt: null, now: new Date("2026-11-26T17:40:00Z") }), "retry");
});

test("the 25-26 Nov outage: 31 hours without a story is an alarm with an email", () => {
  const r = storyGapReport({
    lastStoryAt: "2026-11-25T10:00:31Z",
    now: new Date("2026-11-26T17:40:00Z"),
    retryPublished: false,
    retryDetail: "skipped: brand_safety",
    causes: ["instagram-stories: skipped (brand_safety) x4"],
  });
  assert.equal(r.level, "alarm");
  assert.match(r.telegram, /32 hours without a story/);
  assert.match(r.body, /brand_safety/);
  assert.ok(r.subject.length > 0);
});

test("one missed slot after a story five hours earlier is a notice, no email", () => {
  const r = storyGapReport({
    lastStoryAt: "2026-11-26T05:00:30Z",
    now: new Date("2026-11-26T10:40:00Z"),
    retryPublished: false,
    retryDetail: "error: Story processing timeout",
    causes: [],
  });
  assert.equal(r.level, "notice");
  assert.equal(r.subject, "");
});

test("a retry that published says so and sends no email", () => {
  const r = storyGapReport({
    lastStoryAt: "2026-11-26T05:00:30Z",
    now: new Date("2026-11-26T10:40:00Z"),
    retryPublished: true,
    retryDetail: "",
    causes: ["instagram-stories: skipped (brand_safety)"],
  });
  assert.equal(r.level, "fixed");
  assert.equal(r.subject, "");
  assert.match(r.telegram, /went out/);
});
