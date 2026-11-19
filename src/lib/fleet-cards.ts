// What a yacht post says beyond its photographs.
// Pure functions only (no imports): `node --test scripts/ig-tests/fleet-cards.test.ts`.
//
// 2026-11-19 (George, after the Instagram research). The feed was a
// catalogue: brochure photographs with a specification caption in a
// faceless "we". Instagram's April 2026 originality rule stops
// recommending accounts that mostly post what they did not create, and
// the research on trust says a named broker's judgement is what a small
// house has that the big ones do not.
//
// George's decision: the posts speak as him, in the first person, but
// ONLY from what he has already written on the site. Every yacht carries
// his insider tip and his "ideal for" in Sanity. So the text cards in a
// carousel are built from his words, cut but never rewritten, and from
// facts on the yacht's page. Nothing here invents an opinion.
//
// The cost card states the house's published position and nothing more.
// The numbers below mirror george-yachts/lib/apaFacts.js (2026-08-08,
// sourced from MYBA and industry convention). If that file changes,
// change this one. Greek VAT is deliberately given no figure there
// ("charged at the yacht's certified rate"), so it is given none here.

export type CardYacht = {
  name: string;
  category?: string | null;
  georgeInsiderTip?: string | null;
  idealFor?: string | null;
  sleeps?: string | null;
  cabins?: string | null;
  crew?: string | null;
  homePort?: string | null;
  cruisingRegion?: string | null;
  builder?: string | null;
  weeklyRatePrice?: string | null;
  priceModel?: string | null;
};

/** "S/CAT Ad Astra" -> "Ad Astra". The prefix is a catalogue habit, not her name. */
export function shortName(name: string): string {
  return String(name ?? "")
    .replace(/^\s*(S\/CAT|P\/CAT|M\/CAT|M\/Y|S\/Y|M\/S|S\/V|M\/V)\s+/i, "")
    .trim();
}

function sentences(text: string): string[] {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'“‘])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The opening of George's insider tip, verbatim, as whole sentences.
 * Returns null when even the first sentence does not fit: a quotation
 * cut in the middle of a thought is not his note any more.
 */
export function noteExcerpt(tip: string | null | undefined, max = 240): string | null {
  const parts = sentences(tip ?? "");
  if (parts.length === 0) return null;
  let out = "";
  for (const s of parts) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  return out.length >= 40 ? out : null;
}

/**
 * Up to `n` entries of his "ideal for" list, each short enough for one
 * line. When he wrote a sentence instead of a list, the sentence comes
 * back whole as a single entry.
 */
export function idealItems(idealFor: string | null | undefined, n = 3, maxLen = 56): string[] {
  const raw = String(idealFor ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  // Split on commas and semicolons that are not inside parentheses.
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of raw) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      items.push(cur);
      cur = "";
    } else cur += ch;
  }
  items.push(cur);
  const parts = items.map((s) => s.trim().replace(/\.$/, "")).filter(Boolean);
  // A list often closes ", and first-time charterers": that "and" is
  // punctuation, not part of the entry.
  if (parts.length >= 3) parts[parts.length - 1] = parts[parts.length - 1].replace(/^and\s+/i, "");
  // Some entries are a sentence, not a list ("Four couples, or a family of
  // eight, who want a quiet week"). Splitting a sentence at its commas
  // produces nonsense lines ("Or a family of eight", "Not a refitted
  // one"), so a sentence is kept whole or not used at all. Two signs of a
  // sentence: a part that opens with a joining word, and a part that opens
  // with an article after a part with a "who" clause ("Four couples who
  // want a fast week, a jacuzzi on the flybridge ..."), where what follows
  // the comma is what they want, not a second kind of guest.
  const JOINING =
    /^(or|and|who|whom|which|that|but|with|without|while|because|so|not|plus|including|especially|rather|even|then|in|at|on|for|to|from)\b/i;
  const clauseAt = parts.findIndex((s) => /\s(who|whom|which)\s/i.test(s));
  const isProse =
    parts.some((s) => JOINING.test(s)) ||
    (clauseAt >= 0 && parts.slice(clauseAt + 1).some((s) => /^(a|an|the)\s/i.test(s)));
  const whole = raw.replace(/\.$/, "");
  // A single phrase is a card when it says something ("Eleven guests who
  // want a yacht with a history"), not when it is one word ("Everyone").
  const asSentence = (): string[] =>
    whole.length >= 30 && whole.length <= 170 ? [whole.charAt(0).toUpperCase() + whole.slice(1)] : [];
  if (isProse || parts.length === 1) return asSentence();
  // When one of the leading entries is too long for a line, dropping it
  // would drop the guests he named first. If the whole text fits as a
  // sentence, it goes whole; only a long list is cut to the lines that fit.
  const leadTooLong = parts.slice(0, n).some((s) => s.length > maxLen);
  if (leadTooLong && asSentence().length) return asSentence();
  const clean = parts
    .filter((s) => s.length >= 6 && s.length <= maxLen)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  const picked = clean.slice(0, n);
  return picked.length >= 2 ? picked : asSentence();
}

/**
 * The weekly charter fee as the site states it, for the whole yacht.
 * Null when it is on request, or priced any way other than per yacht per
 * week: this house sells one product and never divides a rate per person.
 */
export function feeLine(yacht: CardYacht): string | null {
  if (yacht.priceModel && yacht.priceModel !== "per_yacht_week") return null;
  const raw = String(yacht.weeklyRatePrice ?? "").split("|")[0].trim();
  if (!raw || /request|poa/i.test(raw)) return null;
  if (!/[€$£]\s?\d/.test(raw)) return null;
  if (/per\s+(person|guest|cabin|pax)|\bpp\b|\/\s*(person|guest|pax)/i.test(String(yacht.weeklyRatePrice))) return null;
  const tidy = raw
    .replace(/\s*[-–—]\s*/g, " to ")
    .replace(/\s+/g, " ")
    .replace(/\s*(per|a|\/)\s*week$/i, "")
    .trim();
  return `${tidy} per week`;
}

/** APA band by yacht type. Mirrors george-yachts/lib/apaFacts.js. */
export function apaBand(category: string | null | undefined): string {
  switch (category) {
    case "sailing-monohulls":
      return "20 to 30%";
    case "sailing-catamarans":
      return "25 to 35%";
    case "motor-yachts":
      return "30 to 40%";
    default:
      return "20 to 40%"; // the honest full span when the type has no band of its own
  }
}

export type CostRow = { label: string; value: string };

/** Rows of the cost card, or null when there is no fee to state. */
export function costRows(yacht: CardYacht): CostRow[] | null {
  const fee = feeLine(yacht);
  if (!fee) return null;
  return [
    { label: "Charter fee", value: `${fee}, whole yacht with her crew` },
    { label: "APA", value: `About ${apaBand(yacht.category)} of the fee: fuel, food, berths. What is not spent comes back to you.` },
    { label: "Greek VAT", value: "Charged at the yacht's certified rate." },
    { label: "Crew gratuity", value: "Separate and customary, 10 to 15% of the fee." },
  ];
}

/** "10 guests · 5 cabins · crew of 5 · Athens (Alimos)" from the yacht's page. */
export function factsLine(yacht: CardYacht): string {
  const num = (s: string | null | undefined) => String(s ?? "").match(/\d+/)?.[0] ?? null;
  const parts = [
    num(yacht.sleeps) && `${num(yacht.sleeps)} guests`,
    num(yacht.cabins) && `${num(yacht.cabins)} cabins`,
    num(yacht.crew) && `crew of ${num(yacht.crew)}`,
    yacht.homePort && String(yacht.homePort).trim().slice(0, 28),
  ].filter(Boolean);
  return parts.join(" · ");
}

export type Card =
  | { kind: "note"; yacht: string; text: string }
  | { kind: "suits"; yacht: string; items: string[]; facts: string }
  | { kind: "cost"; yacht: string; rows: CostRow[]; cta: string };

/** The text cards a yacht can honestly carry. A yacht with thin data gets fewer. */
export function buildCards(yacht: CardYacht): Card[] {
  const name = shortName(yacht.name);
  const cards: Card[] = [];
  const note = noteExcerpt(yacht.georgeInsiderTip);
  if (note) cards.push({ kind: "note", yacht: name, text: note });
  const items = idealItems(yacht.idealFor);
  if (items.length) cards.push({ kind: "suits", yacht: name, items, facts: factsLine(yacht) });
  const rows = costRows(yacht);
  if (rows) cards.push({ kind: "cost", yacht: name, rows, cta: `DM me "${name.toUpperCase()}" for her dates` });
  return cards;
}

export type Slide = { type: "photo"; url: string } | { type: "card"; card: Card };

/**
 * Carousel order. The hero photograph leads (it is what the grid shows),
 * his note is the first thing a swipe reveals, who she suits sits in the
 * middle, the cost closes. Instagram allows ten slides.
 */
export function planSlides(photos: string[], cards: Card[], max = 10): Slide[] {
  const room = Math.max(0, max - cards.length);
  const p = photos.slice(0, room).map((url) => ({ type: "photo", url }) as Slide);
  const byKind = (k: Card["kind"]) => cards.filter((c) => c.kind === k).map((card) => ({ type: "card", card }) as Slide);
  const head = p.slice(0, 1);
  const rest = p.slice(1);
  const half = Math.ceil(rest.length / 2);
  return [...head, ...byKind("note"), ...rest.slice(0, half), ...byKind("suits"), ...rest.slice(half), ...byKind("cost")];
}

/**
 * Instagram crops every slide of a carousel to the shape of the first.
 * Cards are therefore drawn at the hero photograph's shape. Sanity image
 * URLs carry their pixel size ("-2500x1406.jpg").
 */
export function cardSizeFor(heroUrl: string): { width: number; height: number } {
  const m = String(heroUrl).match(/-(\d+)x(\d+)\.(?:jpg|jpeg|png|webp)(?:\?|$)/i);
  const ratio = m ? Number(m[1]) / Number(m[2]) : 1.5;
  const safe = Math.min(1.91, Math.max(0.8, Number.isFinite(ratio) && ratio > 0 ? ratio : 1.5));
  return { width: 1080, height: Math.round(1080 / safe) };
}

/** The closing line of the caption. Chosen in code, so the model never writes a call to action. */
export function closingLine(yachtName: string, dayIndex: number): string {
  const name = shortName(yachtName).toUpperCase();
  const lines = [
    `DM me "${name}" and I will send you her open weeks and what the week costs in full.`,
    `Planning for a group? Send this to whoever is organising.`,
    `DM me your dates and how many you are, and I will tell you honestly whether she fits.`,
  ];
  return lines[Math.abs(Math.trunc(dayIndex)) % lines.length];
}

/** Three to five precise tags. A wall of generic ones no longer helps discovery. */
export function fleetHashtags(yacht: CardYacht): string {
  const region = String(yacht.cruisingRegion ?? "").toLowerCase();
  const regionTag = region.includes("ionian")
    ? "#ioniansea"
    : region.includes("cyclad")
      ? "#cyclades"
      : region.includes("saronic")
        ? "#saronicgulf"
        : region.includes("dodecan")
          ? "#dodecanese"
          : region.includes("sporad")
            ? "#sporades"
            : null;
  const catTag =
    yacht.category === "sailing-catamarans"
      ? "#sailingcatamaran"
      : yacht.category === "power-catamarans"
        ? "#powercatamaran"
        : yacht.category === "sailing-monohulls"
          ? "#sailingyacht"
          : "#motoryacht";
  // The shipyard, as one word. Two-word yards are listed, because the
  // token after a one-word yard is a model ("Lagoon Sixty 5"), not a name.
  // Words that are not a yard at all ("Custom", "Cantieri") give no tag.
  const words = String(yacht.builder ?? "")
    .replace(/\([^)]*\)/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Lürssen -> Lurssen: fold the accent, keep the letter
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const twoWordYards = new Set(["fountaine pajot", "san lorenzo", "custom line", "perini navi", "monte carlo"]);
  const notAYard = new Set([
    "custom", "marine", "cantieri", "cantiere", "astillera", "astilleros", "yachts", "yacht",
    "shipyard", "boats", "moon", "balance", "camper", "bugari", "monte", "the", "di", "de", "van",
  ]);
  const pair = `${words[0]} ${words[1]}`;
  const brandWord = twoWordYards.has(pair)
    ? `${words[0]}${words[1]}`
    : notAYard.has(words[0] ?? "")
      ? ""
      : (words[0] ?? "");
  const tags = ["#yachtchartergreece", catTag, regionTag, brandWord.length >= 4 ? `#${brandWord}` : null, "#georgeyachts"];
  return [...new Set(tags.filter(Boolean) as string[])].slice(0, 5).join(" ");
}

/** Alt text for a photograph: what it shows, in plain words, for search and screen readers. */
export function photoAltText(yacht: CardYacht, shot: string | null | undefined): string {
  const kind =
    yacht.category === "sailing-catamarans"
      ? "crewed sailing catamaran"
      : yacht.category === "power-catamarans"
        ? "crewed power catamaran"
        : yacht.category === "sailing-monohulls"
          ? "crewed sailing yacht"
          : "crewed motor yacht";
  const view = shot === "deck" ? "on deck" : "seen from the water";
  return `${shortName(yacht.name)}, a ${kind} for charter in Greece, ${view}.`.slice(0, 300);
}

export function cardAltText(card: Card): string {
  if (card.kind === "note") return `George P. Biniaris on ${card.yacht}: ${card.text}`.slice(0, 900);
  if (card.kind === "suits") return `Who ${card.yacht} suits: ${card.items.join("; ")}. ${card.facts}`.slice(0, 900);
  return `What a week on ${card.yacht} costs: ${card.rows.map((r) => `${r.label}: ${r.value}`).join(" ")}`.slice(0, 900);
}

/**
 * The model may only restate George's own words. These are the phrasings
 * that mean it has invented a memory, a client or a record instead. A
 * caption that trips this is replaced by the plain fallback.
 */
export function inventedExperience(caption: string): string[] {
  const tests: Array<[RegExp, string]> = [
    [/\b(last|this past) (season|summer|year|week|month)\b/i, "a past occasion"],
    [/\bmy (clients?|guests?|charterers?)\b/i, "his clients"],
    [/\b(a|one) (couple|family|client|guest|group) (from|of|who|told|said)\b/i, "a specific client"],
    [/\bI(?:'ve| have) (sailed|chartered|cruised|skippered|captained|spent|taken|hosted|been aboard|slept)\b/i, "a personal voyage"],
    [/\b\d+\s*(\+\s*)?years?\b[^.]{0,40}\b(experience|in the (business|industry)|as a broker)\b/i, "years of experience"],
    [/\b(years|decades) of experience\b/i, "years of experience"],
    [/\bI (remember|recall|once|was aboard|was on board)\b/i, "a memory"],
    [/\b(best (yacht|broker|charter)s? in (greece|the world|the med\w*)|number one|#1)\b/i, "an unsourced superlative"],
    [/\b(agenc(y|ies)|advisors?|clients?|captains?|guests?|charterers?|people)\b[^.]{0,30}\b(tell|tells|told|say|says|said|report|reports) (me|us)\b/i, "a remark credited to someone else"],
    [/\b(we work with|our (team|fleet|clients|guests))\b/i, "the voice of a company, not of George"],
  ];
  return tests.filter(([re]) => re.test(caption)).map(([, why]) => why);
}
