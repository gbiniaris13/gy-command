/**
 * Journalist requests: the filter and the scoring.
 *
 * 2026-08-08. Backlinks are the ceiling on georgeyachts.com. Bing Webmaster
 * Tools reports ONE referring domain in total, and the Forbes mention turns
 * out to carry rel="nofollow", so it passes no authority at all. Eight cold
 * pitches to editors went out in July, properly written, one a day. Three
 * weeks later: nothing, and one polite decline.
 *
 * Then the real gap turned up in the same inbox. George is subscribed to HARO,
 * Qwoted and Source of Sources, and 201 of their emails arrived in ninety
 * days: three HARO editions a day, Qwoted daily, SOS daily. Every one is
 * filtered into a label, so none of them are read. A Qwoted request from The
 * Maritime Executive expired unanswered the day before this was written.
 *
 * A cold pitch asks a stranger for a favour. A journalist request is someone
 * who has already decided they need a source. The second is worth far more,
 * and we have been throwing them away three times a day since May.
 */

// Longer phrases first: a match on "crewed yacht charter" is worth more than
// a match on "charter", which appears in unrelated finance stories.
const CORE = [
  "luxury yacht charter",
  "superyacht charter",
  "crewed yacht charter",
  "yacht charter",
  "boat charter",
  "sailing holiday",
  "charter broker",
  "yacht broker",
  "superyacht",
  "megayacht",
  "yachting",
  "flotilla",
  "catamaran",
];

const ADJACENT = [
  "greek island",
  "greece",
  "cyclades",
  "ionian",
  "mykonos",
  "santorini",
  "aegean",
  "mediterranean",
  "luxury travel",
  "ultra high net worth",
  "uhnw",
  "private aviation",
  "villa rental",
  "honeymoon",
  "bespoke travel",
  "travel advisor",
  "marina",
  "sailing",
];

// A request from one of these is worth surfacing even on a weaker keyword
// match, because the placement itself is the prize.
const PREMIUM_OUTLETS = [
  "forbes",
  "bloomberg",
  "robb report",
  "boat international",
  "departures",
  "wall street journal",
  "financial times",
  "condé nast",
  "conde nast",
  "travel + leisure",
  "travel and leisure",
  "afar",
  "the times",
  "telegraph",
  "reuters",
  "maritime executive",
  "superyacht times",
];

// Requests that are clearly not ours however many keywords they trip.
const EXCLUDE = [
  "crypto",
  "casino",
  "cbd",
  "dating app",
  "student loan",
  "car insurance",
  "personal injury",
];

export interface ScoredRequest {
  score: number;
  hits: string[];
}

export function scoreRequest(text: string, subject = ""): ScoredRequest {
  const hay = `${subject} ${text}`.toLowerCase();
  if (EXCLUDE.some((k) => hay.includes(k))) return { score: 0, hits: [] };

  let core = 0;
  let adjacent = 0;
  let outlet = 0;
  const hits: string[] = [];

  for (const k of CORE) {
    if (hay.includes(k)) {
      core += 3;
      hits.push(k);
    }
  }
  for (const k of ADJACENT) {
    if (hay.includes(k)) {
      adjacent += 1;
      hits.push(k);
    }
  }
  for (const o of PREMIUM_OUTLETS) {
    if (hay.includes(o)) {
      outlet += 5;
      hits.push(`outlet:${o}`);
    }
  }

  // The first real test of this against a live HARO digest surfaced exactly
  // one match, and it was a Travel + Leisure request for kitchen products. It
  // qualified on the outlet name alone. Prestige decides the order of things
  // worth reading; it does not decide whether something is worth reading. A
  // request has to mention something we actually do.
  if (core === 0) return { score: 0, hits: [] };

  return { score: core + adjacent + outlet, hits: hits.slice(0, 6) };
}

export interface RequestBlock {
  text: string;
  outlet: string | null;
  deadline: string | null;
  replyTo: string | null;
}

/**
 * Cut a digest into whole requests.
 *
 * The first version of this split on blank lines, which was wrong in a way
 * only a real email revealed. HARO sends an INDEX of numbered titles at the
 * top and the full records below, so paragraph splitting matched index lines
 * with no query text behind them and missed every actual request. It also
 * produced a false positive: a Travel + Leisure request for kitchen products
 * scored purely on the outlet name.
 *
 * A HARO record runs "N) Summary: ... " through to "Back to Top", carrying
 * Name, Category, Email, Media Outlet, Deadline and Query. Splitting on that
 * boundary keeps a request whole, which is the only way the scoring sees the
 * query text and the outlet together.
 *
 * Qwoted and SOS do not use that format, so anything that does not look like
 * a HARO digest falls back to paragraph blocks, where their one-request-per-
 * email shape works fine.
 */
export function toBlocks(text: string): RequestBlock[] {
  const looksLikeHaro = /\n\d+\)\s*Summary:/.test(text);

  if (looksLikeHaro) {
    // Drop the index: everything before the first full record.
    const body = text.slice(text.search(/\n\d+\)\s*Summary:/));
    return body
      .split(/\n-{10,}\n/)
      .map((r) => r.trim())
      .filter((r) => /Summary:/.test(r) && /Query:/i.test(r))
      .map((r) => ({
        text: r,
        outlet: (r.match(/Media Outlet:\s*([^(\n]+)/) || [])[1]?.trim() || null,
        deadline: (r.match(/Deadline:\s*([^\n]+)/) || [])[1]?.trim() || null,
        replyTo: (r.match(/(reply\+[\w-]+@helpareporter\.com)/) || [])[1] || null,
      }));
  }

  return text
    .split(/\n\s*\n+/)
    .map((b) => b.replace(/[ \t]+/g, " ").trim())
    .filter((b) => b.length >= 80 && b.length <= 1400)
    .filter(
      (b) =>
        !/^(unsubscribe|view (this )?in browser|privacy policy|manage (your )?preferences|you (are )?receiv)/i.test(
          b
        )
    )
    .map((b) => ({ text: b, outlet: null, deadline: null, replyTo: null }));
}

/**
 * A deadline is the single most useful thing to pull out. A request George
 * sees after it closes is worse than one he never saw, because it only tells
 * him what he missed.
 */
export function findDeadline(block: string): string | null {
  const m = block.match(
    /\b(deadline|respond by|reply by|closes?|expires?|submit before|due)\b[^.\n]{0,60}/i
  );
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

export function findOutlet(block: string, subject: string): string | null {
  // Qwoted and SOS put the outlet in the subject line before a colon.
  const fromSubject = subject.match(/^(?:\[SOS\]\s*)?([A-Z][\w .&'|-]{2,40}?):/);
  if (fromSubject) return fromSubject[1].trim();
  const inBlock = block.match(
    /\b(?:for|from|at|with)\s+([A-Z][\w .&'-]{2,35}(?:Magazine|Times|Post|Journal|Report|Insider|Today|Digest|News|Review|Executive|Weekly|Monthly))/
  );
  return inBlock ? inBlock[1].trim() : null;
}

/**
 * A starting point, not a finished answer.
 *
 * The draft carries the facts George would otherwise have to look up, in the
 * register he actually writes in. Every figure here is one the site already
 * stands behind: the APA band comes from the MYBA research of 2026-08-08,
 * where the finding was that MYBA fixes the mechanism and not the percentage.
 * The gratuity is on the base fee alone. VAT follows the yacht's certificate.
 *
 * He rewrites it. A journalist can smell a template, and the whole point of
 * this house is that a person answers.
 */
export function draftAnswer(block: string): string {
  const q = block.toLowerCase();

  let core: string;
  if (/\bcost|price|pricing|budget|how much|afford|expensive\b/.test(q)) {
    core =
      "A crewed week in Greek waters is quoted in four separate parts, and any broker who blurs them is doing the reader no favours. The base fee covers the yacht and her crew. On top sits the APA, the running float the captain spends against receipts, which runs from roughly 20% of the base on a sailing yacht to 40% on a motor yacht because it tracks fuel burn. Then Greek VAT, which is not one number: it follows each yacht's certification, in practice between 5.2% and 12% on certified commercial yachts, with 24% reserved for short or bareboat arrangements. Last, the crew gratuity, customary at 10 to 15% and calculated on the base fee alone. A realistic 2026 week on a crewed catamaran for eight lands between 25,000 and 60,000 euro all in.";
  } else if (/\bwhen|month|season|weather|meltemi|best time\b/.test(q)) {
    core =
      "The Meltemi is the whole answer. It blows hardest through the Cyclades in July and August, which is exactly when most people book, and a week planned on a map rather than a forecast is the week that spends two days pinned in Paros. Late June and the first half of September give the same warm water with a fraction of the wind and materially lower rates. For families with young children the Ionian is the honest recommendation in any month, because the Meltemi does not reach it.";
  } else if (/\bfamil|child|kid|honeymoon|couple|wedding\b/.test(q)) {
    core =
      "The hull matters less than the crew. Catamarans dominate family charters for real reasons, zero roll at anchor so children sleep through moves, shallow draft that reaches beaches a monohull cannot, and about 40% more deck space at the same length. But the week is made or broken by whether the chef can genuinely cook for a six-year-old as well as for the adults, and whether the stewardess has the hours to watch a child on the swim platform. That is a crew question, and it is the one worth asking a broker.";
  } else if (/\bbroker|book|choose|find|agent|company\b/.test(q)) {
    core =
      "Ask what the person recommending a yacht stands to gain from that particular yacht. A broker holding a central agency mandate is paid to fill specific hulls; one who holds none is free to say a boat is wrong for you. Then check the paperwork: the MYBA standard contract is the Mediterranean norm, and it should set out the base fee, the APA, the yacht's certified VAT rate and the gratuity range before anyone signs. Money should move only against that contract.";
  } else {
    core =
      "Greek waters carry the largest crewed charter fleet in the Mediterranean and the widest range of price, from catamarans in the low tens of thousands a week to fifty metre motor yachts. The variables that decide a good week are the wind, the crew and the certification of the yacht, in that order, and none of them appear in a brochure.";
  }

  return `I am George P. Biniaris, founder and managing broker of George Yachts Brokerage House, a boutique brokerage working exclusively in Greek waters. I hold a sailing skipper's licence and a powerboat licence, and spent a decade running luxury hospitality in Mykonos before broking. IYBA Charter Active Member; featured in Forbes in May 2026.

${core}

Happy to expand on any of this, provide figures from our own booking record, or point you to someone better placed if this is not quite your angle.

George P. Biniaris
George Yachts Brokerage House
georgeyachts.com`;
}
