// Run: node --test scripts/ig-tests/fleet-cards.test.ts
// What a yacht post says beyond its photographs (src/lib/fleet-cards.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shortName, noteExcerpt, idealItems, feeLine, apaBand, costRows, factsLine, buildCards,
  planSlides, cardSizeFor, closingLine, fleetHashtags, photoAltText, inventedExperience,
  type CardYacht,
} from "../../src/lib/fleet-cards.ts";

const adAstra: CardYacht = {
  name: "S/CAT Ad Astra",
  category: "sailing-catamarans",
  georgeInsiderTip:
    "Ad Astra is the crown jewel of our sailing catamaran fleet. She’s one of the world’s first Fountaine Pajot Thíra 80 sailing catamarans ever offered for charter, and she’s available year-round in Greece. The tender alone tells you everything: a Rafnar with twin 300hp Yamaha engines.",
  idealFor:
    "Sailing enthusiasts who want ultra-luxury, large groups of 8-10, year-round charter seekers, clients who want flagship technology with sailing romance, celebration voyages, Cyclades and Ionian exploration",
  sleeps: "10",
  cabins: "5",
  crew: "5: Captain, Chef, 2 Stewardesses, Deckhand",
  homePort: "Athens (Alimos)",
  cruisingRegion: "Greece",
  builder: "Fountaine Pajot Thíra 80",
  weeklyRatePrice: "€65,000 - €90,000 | plus expenses VAT & APA",
  priceModel: "per_yacht_week",
};

test("the catalogue prefix is not her name", () => {
  assert.equal(shortName("S/CAT Ad Astra"), "Ad Astra");
  assert.equal(shortName("M/Y Pareaki II"), "Pareaki II");
  assert.equal(shortName("P/CAT Crazy Horse"), "Crazy Horse");
  assert.equal(shortName("Serenity"), "Serenity");
});

test("his note is his own words: whole sentences, verbatim, never cut mid-thought", () => {
  const note = noteExcerpt(adAstra.georgeInsiderTip)!;
  assert.ok(adAstra.georgeInsiderTip!.startsWith(note), "must be a verbatim prefix of the tip");
  assert.ok(/[.!?]$/.test(note), "ends at a sentence end");
  assert.ok(note.length <= 240);
  assert.equal(noteExcerpt("Short."), null, "too thin to be a note");
  assert.equal(noteExcerpt(null), null);
  const long = "A".repeat(300) + ". Second sentence.";
  assert.equal(noteExcerpt(long), null, "a first sentence that does not fit is not quoted in part");
});

test("'ideal for' becomes short lines, and commas inside brackets do not split", () => {
  assert.deepEqual(idealItems(adAstra.idealFor), [
    "Sailing enthusiasts who want ultra-luxury",
    "Large groups of 8-10",
    "Year-round charter seekers",
  ]);
  assert.deepEqual(idealItems("First-time charterers, families with children (twin cabin, bunk beds), foodie groups"), [
    "First-time charterers",
    "Families with children (twin cabin, bunk beds)",
    "Foodie groups",
  ]);
  assert.deepEqual(idealItems("Everyone"), [], "one entry is not a card");
  // A sentence is not a list: splitting it at its commas made "Or a family of eight".
  assert.deepEqual(idealItems("Four couples, or a family of eight, who want a new Sunreef and a quiet week in the Saronic"), [
    "Four couples, or a family of eight, who want a new Sunreef and a quiet week in the Saronic",
  ]);
  assert.deepEqual(idealItems("Couples, or families, who " + "want very many things ".repeat(12)), [], "a long sentence is left out, not chopped");
  assert.deepEqual(
    idealItems("Four couples who want a fast Cyclades week, a jacuzzi on the flybridge and a steady boat at anchor"),
    ["Four couples who want a fast Cyclades week, a jacuzzi on the flybridge and a steady boat at anchor"],
    "a clause before a comma keeps the sentence whole",
  );
  assert.deepEqual(idealItems("Eleven guests who want a yacht with a history"), ["Eleven guests who want a yacht with a history"], "one full phrase is a card");
  assert.deepEqual(idealItems("Eleven guests who want a recent yacht, not a refitted one"), ["Eleven guests who want a recent yacht, not a refitted one"]);
  assert.deepEqual(idealItems("families with children, budget-conscious groups of 8-10, and first-time charterers"), [
    "Families with children", "Budget-conscious groups of 8-10", "First-time charterers",
  ], "the closing 'and' of a list is dropped");
  assert.deepEqual(
    idealItems("Groups of ten who want a full crewed week under sail without a superyacht budget, food-led charters, and families who prefer five equal cabins to a hierarchy").length,
    1,
    "the guests he names first are never dropped for length",
  );
});

test("the fee is quoted for the whole yacht per week, or not at all", () => {
  assert.equal(feeLine(adAstra), "€65,000 to €90,000 per week");
  assert.equal(feeLine({ ...adAstra, weeklyRatePrice: "From €28,500 | plus expenses" }), "From €28,500 per week");
  assert.equal(feeLine({ ...adAstra, weeklyRatePrice: "Price on request" }), null);
  assert.equal(feeLine({ ...adAstra, weeklyRatePrice: "" }), null);
  assert.equal(feeLine({ ...adAstra, priceModel: "per_person_week" }), null, "never a per-person price");
  assert.equal(feeLine({ ...adAstra, weeklyRatePrice: "€2,900 per person | cabin charter" }), null);
});

test("cost rows mirror the site's APA facts and give VAT no number", () => {
  assert.equal(apaBand("sailing-monohulls"), "20 to 30%");
  assert.equal(apaBand("sailing-catamarans"), "25 to 35%");
  assert.equal(apaBand("motor-yachts"), "30 to 40%");
  assert.equal(apaBand("power-catamarans"), "20 to 40%");
  const rows = costRows(adAstra)!;
  assert.deepEqual(rows.map((r) => r.label), ["Charter fee", "APA", "Greek VAT", "Crew gratuity"]);
  assert.ok(rows[1].value.includes("25 to 35%"));
  assert.ok(!/\d/.test(rows[2].value), "no VAT figure: the site states none");
  assert.ok(rows[3].value.includes("10 to 15%"));
  assert.equal(costRows({ ...adAstra, weeklyRatePrice: "On request" }), null);
  assert.ok(!/per (person|guest)/i.test(JSON.stringify(rows)));
});

test("facts line reads the numbers out of the yacht's page", () => {
  assert.equal(factsLine(adAstra), "10 guests · 5 cabins · crew of 5 · Athens (Alimos)");
  assert.equal(factsLine({ name: "X", sleeps: "8 guests", cabins: null }), "8 guests");
});

test("a yacht with thin data gets fewer cards, never an empty one", () => {
  assert.deepEqual(buildCards(adAstra).map((c) => c.kind), ["note", "suits", "cost"]);
  assert.deepEqual(buildCards({ name: "M/Y Quiet", weeklyRatePrice: "On request" }), []);
  const cost = buildCards(adAstra).find((c) => c.kind === "cost")!;
  assert.equal(cost.kind === "cost" && cost.cta, 'DM me "AD ASTRA" for her dates');
});

test("carousel: hero first, his note second, cost last, ten slides at most", () => {
  const photos = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  const slides = planSlides(photos, buildCards(adAstra));
  assert.equal(slides.length, 10);
  assert.deepEqual(slides[0], { type: "photo", url: "p0" });
  assert.equal(slides[1].type === "card" && slides[1].card.kind, "note");
  assert.equal(slides.at(-1)!.type === "card" && (slides.at(-1) as any).card.kind, "cost");
  assert.equal(slides.filter((s) => s.type === "photo").length, 7);
  const order = slides.map((s) => (s.type === "photo" ? s.url : s.card.kind)).join(",");
  assert.equal(order, "p0,note,p1,p2,p3,suits,p4,p5,p6,cost");
  assert.deepEqual(planSlides(["p0", "p1"], []).map((s: any) => s.url), ["p0", "p1"]);
});

test("cards take the hero's shape, inside what Instagram accepts", () => {
  assert.deepEqual(cardSizeFor("https://cdn.sanity.io/images/x/production/abc-2500x1406.jpg"), { width: 1080, height: 607 });
  assert.deepEqual(cardSizeFor("https://cdn.sanity.io/images/x/production/abc-2000x1500.jpg"), { width: 1080, height: 810 });
  assert.deepEqual(cardSizeFor("https://cdn.sanity.io/images/x/production/abc-3000x1000.jpg"), { width: 1080, height: 565 });
  assert.deepEqual(cardSizeFor("https://example.com/no-size.jpg"), { width: 1080, height: 720 });
});

test("closing lines are first person, rotate, and name her without the prefix", () => {
  const lines = [0, 1, 2].map((d) => closingLine("S/CAT Ad Astra", d));
  assert.equal(new Set(lines).size, 3);
  assert.ok(lines[0].includes('"AD ASTRA"'));
  for (const l of lines) {
    assert.ok(!/\bwe\b|\bour\b|\bus\b/i.test(l), `brand voice in: ${l}`);
    assert.ok(!/[—–]/.test(l) && !/link in bio/i.test(l));
  }
  assert.equal(closingLine("X", 3), closingLine("X", 0));
});

test("three to five hashtags, none generic", () => {
  const tags = fleetHashtags(adAstra).split(" ");
  assert.ok(tags.length >= 3 && tags.length <= 5, tags.join(" "));
  assert.deepEqual(tags, ["#yachtchartergreece", "#sailingcatamaran", "#fountainepajot", "#georgeyachts"]);
  assert.ok(fleetHashtags({ ...adAstra, cruisingRegion: "Ionian & Cyclades" }).includes("#ioniansea"));
  assert.ok(fleetHashtags({ ...adAstra, builder: "L\u00FCrssen 60m" }).includes("#lurssen"), "accents fold, letters are not dropped");
  assert.ok(fleetHashtags({ ...adAstra, builder: "Lagoon Sixty 5" }).includes("#lagoon"));
  assert.ok(!/#custom\b|#cantieri\b|#marine\b/.test(fleetHashtags({ ...adAstra, builder: "Custom Marine Build" })), "a word that is not a yard gives no tag");
  assert.ok(fleetHashtags({ ...adAstra, builder: "Custom Line Navetta 30" }).includes("#customline"));
});

test("alt text says what the photograph shows", () => {
  assert.equal(photoAltText(adAstra, "exterior"), "Ad Astra, a crewed sailing catamaran for charter in Greece, seen from the water.");
  assert.ok(photoAltText({ ...adAstra, category: "motor-yachts" }, "deck").endsWith("on deck."));
});

test("an invented memory, client or record is caught; his real words are not", () => {
  assert.deepEqual(inventedExperience("Last summer a family from Texas told me she was perfect."), ["a past occasion", "a specific client"]);
  assert.ok(inventedExperience("In my 20 years of experience as a broker, few compare.").includes("years of experience"));
  assert.ok(inventedExperience("I have sailed her twice.").includes("a personal voyage"));
  assert.ok(inventedExperience("My clients love her flybridge.").includes("his clients"));
  // George's own published tip, first person, must pass untouched.
  assert.deepEqual(
    inventedExperience(
      "SERENITY sails from Nea Peramos rather than Alimos, and I treat that as an advantage: you are clear of the Athens marina traffic on the first evening.",
    ),
    [],
  );
  assert.deepEqual(inventedExperience(adAstra.georgeInsiderTip!), []);
});

test("a remark is never credited to people George's words do not name", () => {
  assert.ok(inventedExperience("A feature agencies we work with tell me is often requested.").length > 0);
  assert.ok(inventedExperience("Our team knows her well.").length > 0);
  assert.deepEqual(inventedExperience("Her dining saloon seats the entire party at one table, the thing every celebration charter asks me for."), []);
  assert.deepEqual(inventedExperience("SEA YA is the boat I suggest when a party of six asks for pace."), []);
});
