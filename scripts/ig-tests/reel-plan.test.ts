// node --test scripts/ig-tests/reel-plan.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  REEL, buildReelFrames, reelNote, frameTimes, candidateWindows, checkOffsets, stretchVerdict, reelTransformation, reelCaption,
} from "../../src/lib/reel-plan.ts";
import { inventedExperience } from "../../src/lib/fleet-cards.ts";

const seaYa = {
  name: "M/Y SEA YA",
  category: "motor-yachts",
  georgeInsiderTip:
    "Sea Ya is the boat I suggest when a party of six asks for pace: a 2017 Azimut 66 that cruises at 24 knots, which in practice means the itinerary bends to your mood, not the other way round. The 2024 refresh shows in the details, and the full-beam master amidships is the calmest berth on board.",
  idealFor: "Two or three couples, young families, first crewed motor yacht charters",
  sleeps: "6",
  cabins: "3",
  crew: "3",
  homePort: "Athens (Alimos)",
  builder: "Azimut",
  weeklyRatePrice: "€24,000 - €28,000",
  priceModel: "per_yacht_week",
};

test("the frames are his note, who she suits, what the week costs, in that order", () => {
  const frames = buildReelFrames(seaYa);
  assert.deepEqual(frames.map((f) => f.kind), ["note", "suits", "cost"]);
  assert.ok(frames.every((f) => f.yacht === "SEA YA" && /6 guests/.test(f.facts)));
  const note = frames[0];
  assert.ok(note.kind === "note");
  assert.ok(seaYa.georgeInsiderTip.startsWith(note.text) && note.text.endsWith("not the other way round."), "his first sentence, word for word");
  assert.equal(
    reelNote("Sea Ya is the boat I suggest when a party of six asks for pace: a 2017 Azimut 66 that cruises at 24 knots, which in practice means the itinerary bends to your mood and to the weather of the day, not the other way round."),
    "Sea Ya is the boat I suggest when a party of six asks for pace.",
    "a first sentence too long for the space is cut at his own colon",
  );
  assert.equal(reelNote("She is quick. She is dry. She is the one I would pick for a windy week."), "She is quick. She is dry. She is the one I would pick for a windy week.");
  assert.equal(reelNote("A " + "very ".repeat(60) + "long sentence with no pause in it at all."), null, "no pause of his own, no note");
  assert.equal(reelNote("Short: " + "word ".repeat(60)), null, "a cut that leaves almost nothing is not a note");
  assert.equal(reelNote(""), null);
  const cost = frames[2];
  assert.ok(cost.kind === "cost");
  assert.equal(cost.fee, "€24,000 to €28,000 per week");
  assert.match(cost.line, /APA about 30 to 40% of the fee, VAT at her certified rate\.$/);
  assert.equal(cost.cta, 'DM me "SEA YA"');
  // A yacht with nothing written and no stated fee carries no frame, so no reel.
  assert.deepEqual(buildReelFrames({ name: "M/Y BARE", weeklyRatePrice: "Price on request" }), []);
  // On request: no cost frame, the rest stand.
  assert.deepEqual(buildReelFrames({ ...seaYa, weeklyRatePrice: "On request" }).map((f) => f.kind), ["note", "suits"]);
});

test("each frame gets an equal share and the last one stays to the end", () => {
  assert.deepEqual(frameTimes(3), [{ from: 0, to: 6 }, { from: 6, to: 12 }, { from: 12, to: null }]);
  assert.deepEqual(frameTimes(2), [{ from: 0, to: 9 }, { from: 9, to: null }]);
  assert.deepEqual(frameTimes(1), [{ from: 0, to: null }]);
  assert.deepEqual(frameTimes(0), []);
});

test("the stretch never touches the opening or closing tenth of the film", () => {
  for (const d of [23, 60, 118, 184, 257]) {
    const wins = candidateWindows(d);
    assert.ok(wins.length >= 1, `${d}s gives a stretch`);
    const edge = Math.max(2, Math.round(d * 0.1));
    for (const w of wins) {
      assert.ok(w.start >= edge, `${d}s: starts after the opening`);
      assert.ok(w.start + w.length <= d - edge, `${d}s: ends before the closing`);
      assert.ok(w.length >= 8 && w.length <= REEL.seconds);
    }
    assert.equal(new Set(wins.map((w) => w.start)).size, wins.length, "no stretch twice");
  }
  assert.deepEqual(candidateWindows(118)[0], { start: 50, length: 18 }, "the middle first");
  assert.deepEqual(candidateWindows(10), [], "too short a film gives none");
  assert.deepEqual(candidateWindows(0), []);
});

test("frames for the check are spread over the stretch, inside it", () => {
  const offs = checkOffsets({ start: 50, length: 18 });
  assert.equal(offs.length, 9);
  assert.equal(offs[0], 50.5);
  assert.equal(offs.at(-1), 67.5);
  for (let i = 1; i < offs.length; i++) assert.ok(offs[i] - offs[i - 1] <= 2.2, "no gap longer than about two seconds");
  assert.ok(checkOffsets({ start: 3, length: 8 }).every((s) => s >= 3 && s <= 11));
});

test("one marked or unreadable frame and the stretch is not used", () => {
  assert.equal(stretchVerdict(["CLEAN", "Clean.", " clean "]), "clean");
  assert.equal(stretchVerdict(["CLEAN", "MARKED", "CLEAN"]), "marked");
  assert.equal(stretchVerdict(["CLEAN", null, "CLEAN"]), "unknown");
  assert.equal(stretchVerdict(["CLEAN", "I cannot tell"]), "unknown");
  assert.equal(stretchVerdict([]), "unknown");
});

test("the recipe: the stretch, the window's shape, navy above and below, frames at their times, no sound", () => {
  const t = reelTransformation({ start: 50, length: 18 }, [
    { publicId: "gy-ig/reels/frames/sea-ya-1", from: 0, to: 6 },
    { publicId: "gy-ig/reels/frames/sea-ya-2", from: 6, to: null },
  ]);
  assert.deepEqual(t[0], { start_offset: 50, duration: 18 });
  assert.deepEqual(t[1], { width: 1080, height: 810, crop: "fill", gravity: "center" });
  assert.deepEqual(t[2], { width: 1080, height: 1210, crop: "pad", gravity: "south", background: "rgb:0D1B2A" });
  assert.deepEqual(t[3], { width: 1080, height: 1920, crop: "pad", gravity: "north", background: "rgb:0D1B2A" });
  assert.deepEqual(t[4], { overlay: "gy-ig:reels:frames:sea-ya-1" });
  assert.deepEqual(t[5], { flags: "layer_apply", start_offset: 0, end_offset: 6 });
  assert.deepEqual(t[7], { flags: "layer_apply", start_offset: 6 });
  assert.deepEqual(t.at(-1), { audio_codec: "none", video_codec: "h264", quality: "auto:good" });
});

test("the caption is his words and her facts, with nothing written by a model", () => {
  const c = reelCaption(seaYa, new Date("2026-11-24T16:00:00Z"));
  assert.ok(c.startsWith("SEA YA, a crewed motor yacht for 6 guests in Greece. Sea Ya is the boat I suggest"));
  assert.match(c, /€24,000 to €28,000 per week, whole yacht with her crew\./);
  assert.match(c, /#yachtchartergreece/);
  assert.ok(!/M\/Y/.test(c), "no catalogue prefix");
  assert.ok(!/[–—]/.test(c), "no dashes");
  assert.deepEqual(inventedExperience(c), []);
  assert.ok(c.split("\n\n").length === 3, "body, closing line, hashtags");
});
