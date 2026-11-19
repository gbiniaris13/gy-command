// The guide carousels: what a week costs, how a charter works, where and
// when to go, who answers, and which yacht for which group.
// Pure functions only: `node --test scripts/ig-tests/guide-decks.test.ts`.
//
// 2026-11-19 (George, after the Instagram research). Monday and Saturday
// used to carry a generated "lifestyle" caption over a stock photograph
// ("The first light of dawn paints the Aegean..."). The research is plain
// about it: that is the content Instagram stopped recommending in April
// 2026, and it answers no question a person planning a week actually has.
// These decks replace it.
//
// WHERE THE WORDS COME FROM. Nothing here is generated at publish time and
// nothing is invented. Every statement is taken from what the public site
// already says under George's name:
//   george-yachts/lib/houseFaq.js   (about, how it works, home FAQ)
//   george-yachts/lib/apaFacts.js   (the APA rule and bands)
// turned from "we" into "I" where the site itself says George does the
// thing in person ("George handles the enquiry, the shortlist, the
// negotiation, the contract and the crew brief himself"). If those files
// change, change this one. Greek VAT is given no figure, as in the yacht
// cards. Prices are never written here by hand: any price on a slide is
// read from the live fleet at publish time.

import { shortName, feeLine, apaBand, factsLine, noteExcerpt, idealItems, type CardYacht } from "./fleet-cards.ts";

export type GuideYacht = CardYacht & {
  _id?: string;
  slug?: string | null;
  length?: string | null;
  /** Exterior photographs of her, best first. Filled by the caller. */
  exteriors?: string[];
};

export type GuideSlide =
  | { kind: "cover"; label: string; title: string; sub: string; photo?: string | null }
  | { kind: "text"; label: string; heading: string; body: string }
  | { kind: "list"; label: string; heading: string; items: string[]; foot?: string }
  | { kind: "rows"; label: string; heading: string; rows: Array<{ label: string; value: string }>; foot?: string }
  | { kind: "yacht"; label: string; name: string; facts: string; fee: string; note: string; photo: string }
  | { kind: "end"; line: string; keyword: string };

export type GuideDeck = {
  id: string;
  /** Printed small at the top of every slide. */
  label: string;
  title: string;
  sub: string;
  /** Slides between the cover and the closing card. "example" is filled from the live fleet. */
  body: Array<GuideSlide | { kind: "example" }>;
  /** The caption's body. Plain search words first. */
  caption: string;
  /** The word a reader sends by DM. */
  keyword: string;
  endLine: string;
  /** The site page that says the same at length (first comment). */
  page: string;
  tags: string[];
};

const L_COST = "WHAT IT COSTS";
const L_HOW = "HOW IT WORKS";
const L_WHERE = "WHERE AND WHEN";
const L_WHO = "WHO YOU DEAL WITH";

export const GUIDE_DECKS: GuideDeck[] = [
  {
    id: "cost-week",
    label: L_COST,
    title: "What a crewed week in Greece really costs",
    sub: "Four separate lines. Here they are.",
    body: [
      {
        kind: "list",
        label: L_COST,
        heading: "Four separate lines",
        items: ["The charter fee", "The APA", "Greek VAT", "The crew gratuity"],
        foot: "A quote that blurs them is doing you no favours.",
      },
      {
        kind: "text",
        label: L_COST,
        heading: "1. The charter fee",
        body: "The yacht and her crew for the week. One price for the whole yacht, never per person.",
      },
      {
        kind: "text",
        label: L_COST,
        heading: "2. The APA",
        body: "Your running float for fuel, food, drinks and berths. About 20% of the fee on a sailing yacht, up to about 40% on a motor yacht, because it tracks fuel. The captain holds it and accounts for it line by line. What is not spent comes back to you.",
      },
      {
        kind: "text",
        label: L_COST,
        heading: "3. Greek VAT",
        body: "Charged on the charter fee at the yacht's certified rate. The rate is set out in writing before you sign.",
      },
      {
        kind: "text",
        label: L_COST,
        heading: "4. The crew gratuity",
        body: "Customary at 10 to 15%, calculated on the charter fee alone. Entirely at your discretion.",
      },
      { kind: "example" },
    ],
    caption:
      "What a crewed yacht charter in Greece costs, line by line. Four separate things: the charter fee for the yacht and her crew, the APA for fuel, food and berths, Greek VAT at the yacht's certified rate, and the crew gratuity. The fee is one price per yacht per week, never per person. The APA runs from about 20% of the fee on a sailing yacht to about 40% on a motor yacht, and what is not spent comes back to you.",
    keyword: "COST",
    endLine: "with your dates and group size. I will send you real yachts with their numbers.",
    page: "georgeyachts.com/cost-calculator",
    tags: ["#yachtchartergreece", "#crewedyachtcharter", "#yachtchartercost", "#greekislands", "#georgeyachts"],
  },
  {
    id: "apa",
    label: L_COST,
    title: "The APA, explained once",
    sub: "Advance Provisioning Allowance: what it is, what it pays for, what comes back.",
    body: [
      {
        kind: "text",
        label: L_COST,
        heading: "What it is",
        body: "A float you pay before boarding, on top of the charter fee. The captain spends it on your behalf during the week, against receipts.",
      },
      {
        kind: "list",
        label: L_COST,
        heading: "What it pays for",
        items: [
          "Fuel for the yacht and her tender",
          "Food, soft drinks, wine and spirits to your brief",
          "Berthing and port fees along the route",
          "Harbour dues, agent fees and cruising permits",
          "Laundry, ice, water and the week's supplies",
        ],
      },
      {
        kind: "list",
        label: L_COST,
        heading: "What it does not cover",
        items: [
          "The crew gratuity, customary at 10 to 15% of the fee",
          "Greek VAT, charged at the yacht's certified rate",
          "What you arrange ashore: restaurants, guides, transfers",
        ],
      },
      {
        kind: "rows",
        label: L_COST,
        heading: "How much",
        rows: [
          { label: "Sailing yacht", value: "About 20 to 30% of the fee" },
          { label: "Catamaran", value: "About 25 to 35% of the fee" },
          { label: "Motor yacht", value: "About 30 to 40% of the fee" },
        ],
        foot: "It tracks fuel more than anything else.",
      },
      {
        kind: "text",
        label: L_COST,
        heading: "Why it moves",
        body: "The contract sets how the APA works, not what it costs. The amount is agreed and written into your contract. A week of marina berths carries a larger float than a week at anchor.",
      },
      {
        kind: "text",
        label: L_COST,
        heading: "What comes back",
        body: "Receipts are reconciled at the end of the week. The unused balance is returned to you.",
      },
    ],
    caption:
      "APA in a yacht charter, explained once. The Advance Provisioning Allowance is a float paid before boarding, on top of the charter fee. The captain spends it on fuel, food, drinks and berths, against receipts, and the unused balance is returned to you. In Greece it runs from about 20% of the fee on a sailing yacht to about 40% on a motor yacht, because it tracks fuel more than anything else.",
    keyword: "APA",
    endLine: "with the yacht you are looking at. I will tell you what float to expect.",
    page: "georgeyachts.com/advance-provisioning-allowance-apa-greek-yacht-charter-explained",
    tags: ["#yachtchartergreece", "#crewedyachtcharter", "#apa", "#yachtcharter", "#georgeyachts"],
  },
  {
    id: "five-steps",
    label: L_HOW,
    title: "How booking a crewed charter works",
    sub: "Five steps, from the first message to the passerelle.",
    body: [
      {
        kind: "text",
        label: L_HOW,
        heading: "1. One conversation",
        body: "You tell me the week, the group and roughly the budget. A conversation, not a form.",
      },
      {
        kind: "text",
        label: L_HOW,
        heading: "2. A real shortlist",
        body: "Yachts genuinely available for your dates, with the charter fee, the APA, the certified VAT rate and the gratuity range written out. Not a brochure.",
      },
      {
        kind: "text",
        label: L_HOW,
        heading: "3. You choose",
        body: "I hold the week while the paperwork is drawn.",
      },
      {
        kind: "text",
        label: L_HOW,
        heading: "4. The contract",
        body: "You sign a MYBA-standard charter agreement and pay to the terms in it.",
      },
      {
        kind: "text",
        label: L_HOW,
        heading: "5. The crew brief",
        body: "Before you arrive, the crew knows your group, your preferences and anything that matters.",
      },
    ],
    caption:
      "How booking a crewed yacht charter in Greece works, in five steps. One conversation about the week, the group and the budget. A shortlist of yachts genuinely available for those dates, with every cost written out. You choose and the week is held. You sign a MYBA-standard contract. The crew is briefed on your group before you board.",
    keyword: "DATES",
    endLine: "with your week and your group size. That is step one.",
    page: "georgeyachts.com/how-it-works",
    tags: ["#yachtchartergreece", "#crewedyachtcharter", "#howtocharterayacht", "#greekislands", "#georgeyachts"],
  },
  {
    id: "when-to-book",
    label: L_HOW,
    title: "When to book a Greek charter week",
    sub: "Peak weeks, shoulder weeks, and the last minute.",
    body: [
      {
        kind: "text",
        label: L_HOW,
        heading: "July and August",
        body: "Six to twelve months out. The yachts that book earliest are the ones everyone wants.",
      },
      {
        kind: "text",
        label: L_HOW,
        heading: "June and September",
        body: "Availability holds much closer in, often at a softer rate for the same yacht, and with better weather for a family.",
      },
      {
        kind: "text",
        label: L_HOW,
        heading: "Inside eight weeks of a peak date",
        body: "Ask anyway. Weeks release, and I would rather tell you honestly what is left than let you believe the market is empty.",
      },
      {
        kind: "text",
        label: L_HOW,
        heading: "The week can start on any day",
        body: "Not only the Saturday the Greek market turns over on. It does not have to be built around a weekend.",
      },
    ],
    caption:
      "When to book a yacht charter in Greece. For peak July and August, six to twelve months ahead, because the yachts that book earliest are the ones everyone wants. June and September hold availability much closer in, often at a softer rate for the same yacht. Inside eight weeks of a peak date it is still worth asking: weeks release.",
    keyword: "DATES",
    endLine: "with your week. I will tell you what is genuinely open.",
    page: "georgeyachts.com/how-it-works",
    tags: ["#yachtchartergreece", "#crewedyachtcharter", "#greece2027", "#greekislands", "#georgeyachts"],
  },
  {
    id: "regions",
    label: L_WHERE,
    title: "Cyclades, Saronic or Ionian?",
    sub: "Three cruising grounds. Which one for your group.",
    body: [
      {
        kind: "text",
        label: L_WHERE,
        heading: "The Cyclades",
        body: "Mykonos, Santorini, Paros, Milos. The islands everyone knows, and the anchorages nobody does. The route is planned around the Meltemi wind.",
      },
      {
        kind: "text",
        label: L_WHERE,
        heading: "The Saronic",
        body: "Hydra, Spetses, Aegina. Close to Athens: Hydra by lunch on the first day. The one for a shorter week.",
      },
      {
        kind: "text",
        label: L_WHERE,
        heading: "The Ionian",
        body: "Corfu, Lefkada, Kefalonia. Calm water, and the most family-friendly of the three. You board at Corfu or Lefkada.",
      },
      {
        kind: "rows",
        label: L_WHERE,
        heading: "In one line each",
        rows: [
          { label: "Cyclades", value: "Energy and the scenery everyone pictures" },
          { label: "Saronic", value: "Short weeks out of Athens" },
          { label: "Ionian", value: "Calm water, families" },
        ],
      },
    ],
    caption:
      "Cyclades, Saronic or Ionian for a yacht charter in Greece. The Cyclades (Mykonos, Santorini, Paros, Milos) for energy and scenery, with a route planned around the Meltemi. The Saronic (Hydra, Spetses, Aegina) for a shorter week out of Athens. The Ionian (Corfu, Lefkada, Kefalonia) for calm water and families.",
    keyword: "WHERE",
    endLine: "with who is coming and when. I will tell you which of the three fits.",
    page: "georgeyachts.com/cyclades-vs-ionian-yacht-charter",
    tags: ["#yachtchartergreece", "#cyclades", "#ioniansea", "#saronicgulf", "#georgeyachts"],
  },
  {
    id: "months",
    label: L_WHERE,
    title: "The best month for a yacht week in Greece",
    sub: "It depends on what you want from it.",
    body: [
      {
        kind: "text",
        label: L_WHERE,
        heading: "August",
        body: "Peak summer energy and the longest daylight. Also peak prices, and the Meltemi in the Cyclades.",
      },
      {
        kind: "text",
        label: L_WHERE,
        heading: "September",
        body: "Rates 15 to 25% lower, calmer seas, fewer crowds, and water still warm enough to swim.",
      },
      {
        kind: "text",
        label: L_WHERE,
        heading: "June and July",
        body: "Ideal for the Ionian.",
      },
      {
        kind: "text",
        label: L_WHERE,
        heading: "May and October",
        body: "They work best in the Saronic Gulf.",
      },
    ],
    caption:
      "The best time to charter a yacht in Greece, month by month. August has peak energy, the longest daylight, peak prices and the Meltemi in the Cyclades. September has rates 15 to 25% lower, calmer seas and water still warm enough to swim. June and July are ideal for the Ionian. May and October work best in the Saronic Gulf.",
    keyword: "WHEN",
    endLine: "with the month you have in mind. I will tell you where it works best.",
    page: "georgeyachts.com/best-time-charter-yacht-greece-month-by-month-2026",
    tags: ["#yachtchartergreece", "#greekislands", "#cyclades", "#ioniansea", "#georgeyachts"],
  },
  {
    id: "contract",
    label: L_HOW,
    title: "What a MYBA contract protects you from",
    sub: "The form used across the professional Mediterranean fleet.",
    body: [
      {
        kind: "list",
        label: L_HOW,
        heading: "It fixes what turns into arguments",
        items: [
          "The yacht and the dates",
          "The charter fee",
          "How the APA is held and accounted for",
          "The cancellation terms",
          "What happens if the yacht cannot perform",
        ],
      },
      {
        kind: "text",
        label: L_HOW,
        heading: "If a broker proposes their own paperwork",
        body: "Ask why.",
      },
      {
        kind: "text",
        label: L_HOW,
        heading: "When money moves",
        body: "Only against a signed contract, with the company's bank details given to you in writing.",
      },
    ],
    caption:
      "What a MYBA charter contract protects you from. It is the standard agreement used across the professional Mediterranean fleet, and it fixes the things that turn into arguments: the yacht, the dates, the charter fee, how the APA is held and accounted for, the cancellation terms, and what happens if the yacht cannot perform. Money should move only against a signed contract.",
    keyword: "DATES",
    endLine: "with your week and your group size. I reply personally.",
    page: "georgeyachts.com/how-it-works",
    tags: ["#yachtchartergreece", "#crewedyachtcharter", "#myba", "#yachtcharter", "#georgeyachts"],
  },
  {
    id: "broker-checks",
    label: L_WHO,
    title: "Four checks before you trust a charter broker",
    sub: "Apply them to me too.",
    body: [
      {
        kind: "list",
        label: L_WHO,
        heading: "The four checks",
        items: [
          "A company you can look up",
          "A membership you can verify in the association's own directory",
          "A contract you can read before you pay",
          "A broker who answers the phone on your side of the Atlantic",
        ],
      },
      {
        kind: "rows",
        label: L_WHO,
        heading: "The same four, applied to me",
        rows: [
          { label: "Company", value: "George Yachts Brokerage House LLC, a US company (Wyoming), run from Athens" },
          { label: "Membership", value: "IYBA Charter Active Member, in the public directory" },
          { label: "Contract", value: "MYBA-standard terms, on every charter" },
          { label: "Phone", value: "Miami line, +1 786 798 8798" },
        ],
      },
      {
        kind: "text",
        label: L_WHO,
        heading: "What this house is not",
        body: "Large, or old. It is boutique and it was founded in 2026. If scale or decades are your filter, say so early and I will tell you honestly whether I fit.",
      },
    ],
    caption:
      "Which yacht charter broker to use in Greece: four checks, and apply them to me too. A company you can look up. A membership you can verify in the association's own directory. A contract you can read before you pay. A broker who answers the phone on your side of the Atlantic. George Yachts Brokerage House LLC is a US company run from Athens, an IYBA Charter Active Member, writing every charter on MYBA-standard terms.",
    keyword: "DATES",
    endLine: "with your week and your group size. I reply personally.",
    page: "georgeyachts.com/about-us",
    tags: ["#yachtchartergreece", "#yachtbroker", "#crewedyachtcharter", "#greekislands", "#georgeyachts"],
  },
  {
    id: "weeks-not-days",
    label: L_HOW,
    title: "Why I write weeks, not days",
    sub: "Fully crewed, by the week, in Greek waters.",
    body: [
      {
        kind: "text",
        label: L_HOW,
        heading: "The week is flexible",
        body: "It can start on any day, not only the Saturday the Greek market turns over on.",
      },
      {
        kind: "list",
        label: L_HOW,
        heading: "What a week allows",
        items: [
          "A crew that learns your group",
          "A route built backwards from the forecast, not from a map",
          "Yachts and crews doing what they are set up to do properly",
        ],
      },
      {
        kind: "text",
        label: L_HOW,
        heading: "If you want a single day",
        body: "Say so, and I will point you somewhere honest rather than sell you the wrong thing.",
      },
    ],
    caption:
      "Crewed yacht charters in Greece by the week, not by the day. The week can start on any day, not only the Saturday the Greek market turns over on. A week is what lets a crew learn your group and lets a route be built backwards from the forecast instead of a map. For a single day out of Athens or Mykonos, ask, and I will point you somewhere honest.",
    keyword: "DATES",
    endLine: "with your week and your group size. I reply personally.",
    page: "georgeyachts.com/how-it-works",
    tags: ["#yachtchartergreece", "#crewedyachtcharter", "#greekislands", "#yachtcharter", "#georgeyachts"],
  },
  {
    id: "who-answers",
    label: L_WHO,
    title: "Who answers when you message George Yachts",
    sub: "I do. Here is who that is.",
    body: [
      {
        kind: "text",
        label: L_WHO,
        heading: "George P. Biniaris",
        body: "Founder and Managing Broker of George Yachts Brokerage House LLC. I answer my own enquiries.",
      },
      {
        kind: "list",
        label: L_WHO,
        heading: "On the water",
        items: [
          "From a Cycladic family from Syros",
          "Sailing skipper's licence, Olympiacos SFP Sailing Academy",
          "Powerboat licence valid to 25 metres",
          "Charter seasons run out of Corfu",
        ],
      },
      {
        kind: "text",
        label: L_WHO,
        heading: "Before broking",
        body: "A decade in luxury hospitality in Mykonos, across a five-star hotel and a beach club.",
      },
      {
        kind: "text",
        label: L_WHO,
        heading: "One person throughout",
        body: "The enquiry, the shortlist, the negotiation, the contract and the crew brief. Reachable through the charter week, not only up to the deposit.",
      },
    ],
    caption:
      "Who answers when you message George Yachts about a yacht charter in Greece: I do. George P. Biniaris, founder and Managing Broker. From a Cycladic family from Syros, a licensed sailing skipper, with a decade in luxury hospitality in Mykonos before broking. The same person handles the enquiry, the shortlist, the contract and the crew brief.",
    keyword: "DATES",
    endLine: "with your week and your group size. I reply personally.",
    page: "georgeyachts.com/about-us",
    tags: ["#yachtchartergreece", "#yachtbroker", "#crewedyachtcharter", "#greekislands", "#georgeyachts"],
  },
  {
    id: "no-owned-yachts",
    label: L_WHO,
    title: "I do not own the yachts I charter",
    sub: "That is the point.",
    body: [
      {
        kind: "text",
        label: L_WHO,
        heading: "No hull to fill",
        body: "There is nothing I gain by steering you to one yacht over another. The yacht proposed is the one that fits your dates, your group and your budget.",
      },
      {
        kind: "text",
        label: L_WHO,
        heading: "If the right yacht is not on my list",
        body: "I will tell you, and go and find it.",
      },
      {
        kind: "text",
        label: L_WHO,
        heading: "The honest trade",
        body: "A large agency has more people and a longer history. This house has neither. What it has is one broker, from the first message to the last day.",
      },
    ],
    caption:
      "A yacht charter broker in Greece who does not own the yachts. There is no hull here under pressure to be filled, so the yacht proposed is the one that fits your dates, your group and your budget. If the right yacht for your week is not on my list, I will tell you and go and find it.",
    keyword: "DATES",
    endLine: "with your week and your group size. I reply personally.",
    page: "georgeyachts.com/about-us",
    tags: ["#yachtchartergreece", "#yachtbroker", "#crewedyachtcharter", "#greekislands", "#georgeyachts"],
  },
];

// ── Live decks: which yacht for which group ────────────────────────────

export type ShortlistSpec = {
  id: string;
  keyword: string;
  /** "ten guests" */
  who: string;
  guests?: number;
  category?: string;
  /** Words for the title: "Crewed yachts", "Crewed catamarans", "Motor yachts". */
  noun: string;
};

export const SHORTLIST_SPECS: ShortlistSpec[] = [
  { id: "ten-guests", keyword: "TEN", who: "ten guests", guests: 10, noun: "crewed yachts" },
  { id: "eight-guests", keyword: "EIGHT", who: "eight guests", guests: 8, noun: "crewed yachts" },
  { id: "sailing-cats", keyword: "CAT", who: "a week under sail", category: "sailing-catamarans", noun: "crewed sailing catamarans" },
  { id: "twelve-guests", keyword: "TWELVE", who: "twelve guests", guests: 12, noun: "crewed yachts" },
  { id: "power-cats", keyword: "POWER", who: "space at speed", category: "power-catamarans", noun: "crewed power catamarans" },
  { id: "six-guests", keyword: "SIX", who: "six guests", guests: 6, noun: "crewed yachts" },
  { id: "motor-yachts", keyword: "MOTOR", who: "covering more islands", category: "motor-yachts", noun: "crewed motor yachts" },
];

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five"];

function guestsOf(y: GuideYacht): number | null {
  const m = String(y.sleeps ?? "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** The lower weekly fee as a number, or null. "€24,000 - €28,000" -> 24000. */
export function lowFee(y: CardYacht): number | null {
  if (!feeLine(y)) return null;
  const m = String(y.weeklyRatePrice ?? "").match(/\d[\d.,]{3,}/);
  if (!m) return null;
  const n = Number(m[0].replace(/[.,]/g, ""));
  return Number.isFinite(n) && n >= 5000 ? n : null;
}

const eur = (n: number) => `EUR ${Math.round(n).toLocaleString("en-US")}`;

/** What George says of her in a line: his tip's opening, else who she suits. */
function yachtLine(y: GuideYacht): string {
  return noteExcerpt(y.georgeInsiderTip, 150) ?? idealItems(y.idealFor, 1, 150)[0] ?? "";
}

function yachtFacts(y: GuideYacht): string {
  // "19.00 m" reads as a typo for most people: "19 m".
  const len = String(y.length ?? "").trim().replace(/(\d)\.0+(?=\s|$|[a-z])/i, "$1").replace(/(\.\d)0(?=\s|$|[a-z])/i, "$1");
  return [len && len.length <= 14 ? len : null, factsLine(y)].filter(Boolean).join(" · ");
}

/**
 * Up to five cleared yachts that match, cheapest first, starting at
 * `offset` so the same spec shows other yachts the next time round.
 * Only yachts with a stated weekly fee and an exterior photograph.
 */
export function shortlistYachts(pool: GuideYacht[], spec: ShortlistSpec, offset = 0, n = 5): GuideYacht[] {
  const fits = pool
    .filter((y) => (y.exteriors?.length ?? 0) > 0 && lowFee(y) !== null)
    .filter((y) => (spec.guests ? guestsOf(y) === spec.guests : true))
    .filter((y) => (spec.category ? y.category === spec.category : true))
    .sort((a, b) => (lowFee(a) as number) - (lowFee(b) as number));
  if (fits.length <= n) return fits;
  const start = ((offset % fits.length) + fits.length) % fits.length;
  const picked = Array.from({ length: n }, (_, i) => fits[(start + i) % fits.length]);
  return picked.sort((a, b) => (lowFee(a) as number) - (lowFee(b) as number));
}

export type BuiltDeck = {
  id: string;
  kind: "guide" | "shortlist";
  slides: GuideSlide[];
  caption: string;
  page: string;
  tags: string[];
  /** Names of the yachts shown, for the log. */
  yachts: string[];
};

function endSlide(keyword: string, line: string): GuideSlide {
  return { kind: "end", keyword, line };
}

/** The worked example on the cost deck: one live yacht, her own numbers. */
export function exampleSlide(y: GuideYacht, label: string): GuideSlide | null {
  const low = lowFee(y);
  if (!low) return null;
  const band = apaBand(y.category).match(/(\d+) to (\d+)/);
  if (!band) return null;
  const [lo, hi] = [Number(band[1]), Number(band[2])];
  return {
    kind: "rows",
    label,
    heading: `A real example: ${shortName(y.name).toUpperCase()}`,
    rows: [
      { label: "Charter fee", value: `From ${eur(low)} for the week` },
      { label: `APA, ${lo} to ${hi}%`, value: `${eur((low * lo) / 100)} to ${eur((low * hi) / 100)}, the unspent part returned` },
      { label: "Greek VAT", value: "At her certified rate" },
      { label: "Gratuity, 10 to 15%", value: `${eur(low * 0.1)} to ${eur(low * 0.15)}, at your discretion` },
    ],
    foot: yachtFacts(y),
  };
}

/** A written guide, with its cover photograph and worked example taken from the live fleet. */
export function buildGuideDeck(deck: GuideDeck, pool: GuideYacht[], turn = 0): BuiltDeck {
  const withPhoto = pool.filter((y) => (y.exteriors?.length ?? 0) > 0);
  const coverYacht = withPhoto.length ? withPhoto[Math.abs(turn) % withPhoto.length] : null;
  const priced = withPhoto.filter((y) => lowFee(y) !== null);
  const exampleYacht = priced.length ? priced[Math.abs(turn * 7 + 3) % priced.length] : null;
  const yachts: string[] = [];
  const slides: GuideSlide[] = [
    { kind: "cover", label: deck.label, title: deck.title, sub: deck.sub, photo: coverYacht?.exteriors?.[0] ?? null },
  ];
  for (const s of deck.body) {
    if (s.kind !== "example") {
      slides.push(s);
      continue;
    }
    const ex = exampleYacht ? exampleSlide(exampleYacht, deck.label) : null;
    if (ex) {
      slides.push(ex);
      yachts.push(exampleYacht!.name);
    }
  }
  slides.push(endSlide(deck.keyword, deck.endLine));
  return {
    id: deck.id,
    kind: "guide",
    slides,
    caption: deck.caption,
    page: deck.page,
    tags: deck.tags,
    yachts,
  };
}

/** A live shortlist, or null when fewer than three cleared yachts match. */
export function buildShortlistDeck(spec: ShortlistSpec, pool: GuideYacht[], offset = 0): BuiltDeck | null {
  const picks = shortlistYachts(pool, spec, offset);
  if (picks.length < 3) return null;
  const count = WORDS[picks.length] ?? String(picks.length);
  const label = "WHICH YACHT";
  const title = `${count} ${spec.noun} for ${spec.who} in Greece`;
  const cover = picks[picks.length - 1];
  const slides: GuideSlide[] = [
    {
      kind: "cover",
      label,
      title,
      sub: "Each with what she costs for the week, whole yacht.",
      photo: cover.exteriors?.[1] ?? cover.exteriors?.[0] ?? null,
    },
    ...picks.map(
      (y, i): GuideSlide => ({
        kind: "yacht",
        label: `${i + 1} OF ${picks.length}`,
        name: shortName(y.name).toUpperCase(),
        facts: yachtFacts(y),
        fee: feeLine(y) as string,
        note: yachtLine(y),
        photo: y.exteriors![0],
      }),
    ),
    endSlide(spec.keyword, "and I will tell you which of these are open for your dates."),
  ];
  const list = picks
    .map((y) => `${shortName(y.name).toUpperCase()}, ${String(feeLine(y)).replace(/\s*per week$/, "").replace(/^From\b/, "from")}`)
    .join(". ");
  const caption = `${count} ${spec.noun} for ${spec.who} in Greece, each with her weekly rate for the whole yacht and her crew. ${list}. The APA, Greek VAT at the yacht's certified rate and the crew gratuity are separate. One price per yacht per week, never per person.`;
  const catTag =
    spec.category === "sailing-catamarans"
      ? "#catamarancharter"
      : spec.category === "power-catamarans"
        ? "#powercatamaran"
        : spec.category === "motor-yachts"
          ? "#motoryacht"
          : "#crewedyachtcharter";
  return {
    id: `shortlist-${spec.id}`,
    kind: "shortlist",
    slides,
    caption,
    page: "georgeyachts.com/charter-yacht-greece",
    tags: ["#yachtchartergreece", catTag, "#greekislands", "#georgeyachts"],
    yachts: picks.map((y) => y.name),
  };
}

/**
 * Which deck goes out on turn `n` (0, 1, 2 ... one per published guide).
 * Two written guides, then one live shortlist. A shortlist that cannot be
 * built (too few yachts) falls back to the next written guide.
 */
export function pickDeck(n: number, pool: GuideYacht[]): BuiltDeck {
  const turn = Math.max(0, Math.trunc(n));
  const round = Math.floor(turn / 3);
  const pos = turn % 3;
  if (pos === 2) {
    for (let i = 0; i < SHORTLIST_SPECS.length; i++) {
      const spec = SHORTLIST_SPECS[(round + i) % SHORTLIST_SPECS.length];
      const cycle = Math.floor(round / SHORTLIST_SPECS.length);
      const built = buildShortlistDeck(spec, pool, cycle * 5);
      if (built) return built;
    }
  }
  const guideIndex = (round * 2 + Math.min(pos, 1)) % GUIDE_DECKS.length;
  return buildGuideDeck(GUIDE_DECKS[guideIndex], pool, turn);
}

/** The closing card's sentence, as it also ends the caption. */
export function endSentence(slide: Extract<GuideSlide, { kind: "end" }>): string {
  return `DM me "${slide.keyword}" ${slide.line}`;
}

/** The published caption: body, the DM line, three to five hashtags. */
export function guideCaption(deck: BuiltDeck): string {
  const end = deck.slides.find((s): s is Extract<GuideSlide, { kind: "end" }> => s.kind === "end");
  const close = end ? endSentence(end) : "DM me your dates and group size. I reply personally.";
  return `${deck.caption}\n\n${close}\n\n${deck.tags.slice(0, 5).join(" ")}`;
}

/** Alt text: the slide's own words, so a screen reader hears the guide. */
export function guideAlt(slide: GuideSlide): string {
  const cut = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 480);
  switch (slide.kind) {
    case "cover":
      return cut(`${slide.title}. ${slide.sub}`);
    case "text":
      return cut(`${slide.heading}. ${slide.body}`);
    case "list":
      return cut(`${slide.heading}: ${slide.items.join("; ")}.${slide.foot ? ` ${slide.foot}` : ""}`);
    case "rows":
      return cut(`${slide.heading}. ${slide.rows.map((r) => `${r.label}: ${r.value}`).join(". ")}.`);
    case "yacht":
      return cut(`${slide.name}, a crewed yacht for charter in Greece. ${slide.facts}. ${slide.fee}. ${slide.note}`);
    case "end":
      return cut(`${endSentence(slide)} George P. Biniaris, George Yachts.`);
  }
}

/** Every string a deck would publish, for the checks in the tests. */
export function deckText(deck: BuiltDeck): string {
  return [deck.caption, ...deck.slides.map(guideAlt)].join("\n");
}
