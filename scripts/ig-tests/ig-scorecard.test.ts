// node --test scripts/ig-tests/ig-scorecard.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { kindOf, targetFor, summarise, scorecardLines, type WeekNumbers } from "../../src/lib/ig-scorecard.ts";

const week = (over: Partial<WeekNumbers> = {}): WeekNumbers => ({
  posts: [
    { kind: "reel", reach: 800, saves: 3, shares: 8, profileVisits: 9 },
    { kind: "reel", reach: 400, saves: 1, shares: 2, profileVisits: 3 },
    { kind: "yacht", reach: 300, saves: 2, shares: 1, profileVisits: 2 },
    { kind: "guide", reach: 500, saves: 6, shares: 9, profileVisits: 6 },
  ],
  messages: 3,
  comments: 4,
  siteVisits: 12,
  briefs: 1,
  ...over,
});

test("posts are sorted into the three things the feed carries", () => {
  assert.equal(kindOf("reel_walkthrough"), "reel");
  assert.equal(kindOf("fleet"), "yacht");
  assert.equal(kindOf("guide"), "guide");
  assert.equal(kindOf(undefined), "other");
});

test("the targets move with the plan: day 30, 60, 90", () => {
  assert.equal(targetFor(new Date("2026-11-23T07:00:00Z")).day, 30);
  assert.equal(targetFor(new Date("2026-11-23T07:00:00Z")).planDay, 4);
  assert.equal(targetFor(new Date("2027-01-10T07:00:00Z")).day, 60);
  assert.equal(targetFor(new Date("2027-06-01T07:00:00Z")).day, 90);
  assert.equal(targetFor(new Date("2026-11-23T07:00:00Z")).reelReach, 600);
});

test("the sums: averages per post, sends per thousand reached", () => {
  const s = summarise(week());
  assert.equal(s.reels, 2);
  assert.equal(s.reelReach, 600);
  assert.equal(s.reachPerPost, 500);
  assert.equal(s.savesPerPost, 3);
  assert.equal(s.profileVisitsPerPost, 5);
  assert.equal(s.sendsPer1000, 10); // 20 sends over 2,000 reached
});

test("a post not measured yet does not count as zero", () => {
  const s = summarise(week({ posts: [{ kind: "reel", reach: null, saves: null, shares: null, profileVisits: null }, { kind: "guide", reach: 200, saves: 2, shares: 1, profileVisits: 4 }] }));
  assert.equal(s.reelReach, null);
  assert.equal(s.reachPerPost, 200);
  assert.equal(s.savesPerPost, 2);
});

test("the report reads in plain words, with last week and the target beside each number", () => {
  const lines = scorecardLines(week(), week({ messages: 1, siteVisits: 5 }), new Date("2026-11-30T07:00:00Z"));
  const text = lines.join("\n");
  assert.match(text, /Went out<\/b>: 2 reels, 1 yacht carousel, 1 guide/);
  assert.match(text, /People reached per reel<\/b>: 600 \(last week 600, target 600\)/);
  assert.match(text, /Messages received<\/b>: 3 \(last week 1, target 2\)/);
  assert.match(text, /Site visits from Instagram<\/b>: 12 \(last week 5, target 10\)/);
  assert.match(text, /Briefs from Instagram visitors<\/b>: 1/);
  assert.ok(!/[–—]/.test(text));
});

test("a silent week and an empty week are said plainly", () => {
  const empty: WeekNumbers = { posts: [], messages: 0, comments: 0, siteVisits: 0, briefs: 0 };
  const text = scorecardLines(empty, empty, new Date("2026-11-23T07:00:00Z")).join("\n");
  assert.match(text, /No post went out this week/);
  assert.match(text, /No message and no brief this week/);
  const noReel = scorecardLines(week({ posts: [{ kind: "yacht", reach: 300, saves: 1, shares: 1, profileVisits: 2 }, { kind: "other", reach: 100, saves: 0, shares: 0, profileVisits: 0 }] }), empty, new Date("2026-11-23T07:00:00Z")).join("\n");
  assert.match(noReel, /Went out<\/b>: 0 reels, 1 yacht carousel, 0 guides, 1 other/);
  assert.match(noReel, /People reached per reel<\/b>: no reel went out \(target 600\)/);
  const unmeasured = scorecardLines(week({ posts: [{ kind: "reel", reach: null, saves: null, shares: null, profileVisits: null }] }), empty, new Date("2026-11-23T07:00:00Z")).join("\n");
  assert.match(unmeasured, /People reached per reel<\/b>: not measured yet/);
});
