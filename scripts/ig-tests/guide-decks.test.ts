// node --test scripts/ig-tests/guide-decks.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  GUIDE_DECKS, SHORTLIST_SPECS, buildGuideDeck, buildShortlistDeck, shortlistYachts, pickDeck,
  guideCaption, guideAlt, deckText, exampleSlide, lowFee, type GuideYacht,
} from "../../src/lib/guide-decks.ts";
import { inventedExperience } from "../../src/lib/fleet-cards.ts";

const yacht = (i: number, over: Partial<GuideYacht> = {}): GuideYacht => ({
  _id: `y${i}`,
  name: `S/CAT Yacht ${i}`,
  category: "sailing-catamarans",
  sleeps: "10",
  cabins: "5",
  crew: "3",
  length: "20.5 m",
  homePort: "Athens (Alimos)",
  weeklyRatePrice: `€${20 + i},000 - €${30 + i},000`,
  priceModel: "per_yacht_week",
  georgeInsiderTip: `Yacht ${i} is the boat I suggest when ten friends want to sail properly. She is quick and dry.`,
  idealFor: "Groups of ten, families with teenagers",
  exteriors: [`https://cdn.sanity.io/images/x/production/a${i}-3000x2000.jpg`, `https://cdn.sanity.io/images/x/production/b${i}-3000x2000.jpg`],
  ...over,
});
const pool: GuideYacht[] = [
  ...Array.from({ length: 8 }, (_, i) => yacht(i)),
  yacht(20, { name: "M/Y Fast One", category: "motor-yachts", sleeps: "8", weeklyRatePrice: "€40,000 - €48,000" }),
  yacht(21, { name: "M/Y No Photo", category: "motor-yachts", exteriors: [] }),
  yacht(22, { name: "M/Y On Request", category: "motor-yachts", weeklyRatePrice: "Price on request" }),
];

test("every written guide obeys the house rules", () => {
  assert.ok(GUIDE_DECKS.length >= 10);
  const ids = new Set(GUIDE_DECKS.map((d) => d.id));
  assert.equal(ids.size, GUIDE_DECKS.length, "ids are unique");
  for (const deck of GUIDE_DECKS) {
    const built = buildGuideDeck(deck, pool, 0);
    const text = deckText(built) + "\n" + guideCaption(built);
    assert.ok(!/[–—]/.test(text), `${deck.id}: no em or en dash`);
    assert.ok(!/\bGeorge Biniaris\b/.test(text), `${deck.id}: the name carries its middle initial`);
    assert.ok(!/\bI am (a|the|your) captain\b|\byour captain\b|\bconcierge\b/i.test(text), `${deck.id}: George is the broker`);
    assert.ok(!/\b(we|our)\b/i.test(text), `${deck.id}: first person singular or plain fact, never "we"`);
    const perPerson = text.match(/per (person|guest|head)/gi) ?? [];
    const neverPerPerson = text.match(/never per (person|guest|head)/gi) ?? [];
    assert.equal(perPerson.length, neverPerPerson.length, `${deck.id}: a price is never divided per person`);
    for (const clause of text.split(/[.;:\n]/).filter((c) => /\bVAT\b/.test(c))) {
      assert.ok(!/\d\s?(%|percent)/i.test(clause), `${deck.id}: VAT carries no figure (${clause.trim()})`);
    }
    assert.deepEqual(inventedExperience(text), [], `${deck.id}: nothing invented`);
    assert.ok(!/[€$£]|\bEUR\s?\d/.test(deck.caption + JSON.stringify(deck.body)), `${deck.id}: no price is written by hand`);
    assert.equal(built.slides[0].kind, "cover");
    assert.equal(built.slides.at(-1)!.kind, "end");
    assert.ok(built.slides.length >= 4 && built.slides.length <= 10, `${deck.id}: 4 to 10 slides`);
    assert.ok(guideCaption(built).length <= 2200, `${deck.id}: caption fits`);
    assert.ok(deck.tags.length >= 3 && deck.tags.length <= 5, `${deck.id}: three to five hashtags`);
    assert.ok(/^georgeyachts\.com\//.test(deck.page));
    for (const s of built.slides) {
      if (s.kind === "text") {
        assert.ok(s.heading.length <= 44, `${deck.id}: heading fits (${s.heading})`);
        assert.ok(s.body.length <= 330, `${deck.id}: body fits (${s.heading})`);
      }
      if (s.kind === "list") {
        assert.ok(s.items.length <= 5, `${deck.id}: five lines at most`);
        for (const it of s.items) assert.ok(it.length <= 66, `${deck.id}: line fits (${it})`);
      }
      if (s.kind === "rows") assert.ok(s.rows.length <= 4, `${deck.id}: four rows at most`);
      assert.ok(guideAlt(s).length > 10);
    }
  }
});

test("the cost guide carries a worked example from a live yacht, with her own numbers", () => {
  const cost = GUIDE_DECKS.find((d) => d.id === "cost-week")!;
  const built = buildGuideDeck(cost, pool, 0);
  const ex = built.slides.find((s) => s.kind === "rows" && /A real example/.test(s.heading));
  assert.ok(ex && ex.kind === "rows");
  assert.equal(built.yachts.length, 1);
  // With no priced yacht the slide is left out and the deck still stands.
  const bare = buildGuideDeck(cost, [], 0);
  assert.ok(!bare.slides.some((s) => s.kind === "rows" && /A real example/.test(s.heading)));
  assert.equal(bare.slides[0].kind === "cover" && bare.slides[0].photo, null);
});

test("the example's arithmetic follows the published bands", () => {
  const s = exampleSlide(yacht(4, { category: "motor-yachts", weeklyRatePrice: "€24,000 - €28,000" }), "X");
  assert.ok(s && s.kind === "rows");
  assert.equal(s.rows[0].value, "From EUR 24,000 for the week");
  assert.equal(s.rows[1].label, "APA, 30 to 40%");
  assert.match(s.rows[1].value, /^EUR 7,200 to EUR 9,600/);
  assert.equal(s.rows[2].value, "At her certified rate");
  assert.match(s.rows[3].value, /^EUR 2,400 to EUR 3,600/);
  assert.equal(exampleSlide(yacht(5, { weeklyRatePrice: "Price on request" }), "X"), null);
  assert.equal(exampleSlide(yacht(5, { priceModel: "per_person" }), "X"), null);
  assert.equal(lowFee(yacht(1, { weeklyRatePrice: "€120.000 - €140.000 | Summer" })), 120000);
  const tidy = exampleSlide(yacht(6, { length: "19.00 m" }), "X");
  assert.ok(tidy && tidy.kind === "rows" && /^19 m · /.test(tidy.foot ?? ""), "19.00 m reads 19 m");
  const half = exampleSlide(yacht(6, { length: "20.50 m" }), "X");
  assert.ok(half && half.kind === "rows" && /^20\.5 m · /.test(half.foot ?? ""));
});

test("a shortlist shows only cleared, priced, photographed yachts that match", () => {
  const ten = SHORTLIST_SPECS.find((s) => s.id === "ten-guests")!;
  const picks = shortlistYachts(pool, ten);
  assert.equal(picks.length, 5);
  assert.ok(picks.every((y) => y.sleeps === "10" && (y.exteriors?.length ?? 0) > 0 && lowFee(y) !== null));
  assert.deepEqual(picks.map(lowFee), [...picks.map(lowFee)].sort((a, b) => (a as number) - (b as number)), "cheapest first");
  // The next time round, other yachts.
  const later = shortlistYachts(pool, ten, 5);
  assert.notDeepEqual(later.map((y) => y._id), picks.map((y) => y._id));
  const built = buildShortlistDeck(ten, pool)!;
  assert.equal(built.slides.length, 7);
  assert.match((built.slides[0] as any).title, /^Five crewed yachts for ten guests in Greece$/);
  const y1 = built.slides[1];
  assert.ok(y1.kind === "yacht" && y1.name === "YACHT 0" && /per week$/.test(y1.fee) && y1.note.length > 20);
  assert.ok(!/S\/CAT/.test(deckText(built)), "no catalogue prefix");
  const single = buildShortlistDeck(ten, pool.map((y, i) => (i === 0 ? { ...y, weeklyRatePrice: "From €17,000" } : y)))!;
  assert.match(single.caption, /YACHT 0, from €17,000\./, "a single rate reads 'from' inside the sentence");
  assert.match(guideCaption(built), /DM me "TEN" and I will tell you which of these are open for your dates\./);
  // Too few to be a list: no deck.
  assert.equal(buildShortlistDeck(SHORTLIST_SPECS.find((s) => s.id === "twelve-guests")!, pool), null);
  assert.equal(buildShortlistDeck(SHORTLIST_SPECS.find((s) => s.id === "motor-yachts")!, pool), null, "one motor yacht with price and photo is not a list");
});

test("the rotation: two written guides, then a shortlist, and it never fails to give a deck", () => {
  const seq = Array.from({ length: 12 }, (_, n) => pickDeck(n, pool));
  assert.deepEqual(seq.map((d) => d.kind), ["guide", "guide", "shortlist", "guide", "guide", "shortlist", "guide", "guide", "shortlist", "guide", "guide", "shortlist"]);
  const guides = seq.filter((d) => d.kind === "guide").map((d) => d.id);
  assert.equal(new Set(guides).size, guides.length, "no written guide repeats inside eight turns");
  assert.equal(seq[0].id, "cost-week", "the first guide out is what a week costs");
  // An empty fleet still publishes the written guides.
  const bare = Array.from({ length: 6 }, (_, n) => pickDeck(n, []));
  assert.ok(bare.every((d) => d.kind === "guide" && d.slides.length >= 4));
});
