// src/lib/helm/supplier-parse.ts
// =============================================================
// DETERMINISTIC reading of a supplier email. No AI, no arithmetic beyond
// the pro-rata split George specified, nothing invented: every function
// here either finds text that is literally present or returns nothing.
//
// It exists because the AI extractor, given a 27-yacht fleet email,
// returned VALID JSON with 20 yachts and nobody noticed (2026-09-09,
// request GY0909260509). A model can omit; a counter cannot. So:
//   • detectYachtBlocks   - the "M/Y NAME model dims" headers, each with
//                           its own slice of the email
//   • parseSeasonRates    - High/Mid/Low season tables in every format the
//                           same email used
//   • parseRateYear       - "RATES 2027" vs the default year
//   • parseApaVat         - APA %, VAT %, and VAT that depends on the area
//   • pickVatForArea      - resolve conditional VAT from the request area
//   • detectTypeConflict  - "S/Y" written on a power catamaran
//   • selectRateForDates  - which tier the charter dates fall in, or the
//                           split-season pro-rata (flagged, never quoted)
// Everything is exported so it can be unit-tested without the AI.
// =============================================================

// ----------------------------------------------------------------- names

/** Stable key for matching the same yacht across the AI output, the header
 *  scan and George's own spelling: lower-case, type prefix dropped, ONLY
 *  letters and digits kept ("HIGH JINKS" == "HIGHJINKS" == "High-Jinks"). */
export function yachtKey(name?: string | null): string {
  let s = (name ?? "").toString().toLowerCase().trim();
  if (!s) return "";
  s = s.replace(/^(m\/?y|s\/?y|m\/?s|m\/?c|s\/?c|p\/?c|motor\s+yacht|sailing\s+yacht|motor\s+catamaran|sailing\s+catamaran|power\s+catamaran|catamaran)\b[\s.:-]*/i, "");
  return s.replace(/[^a-z0-9]+/g, "");
}

/** The Gmail import leaves non-breaking spaces (U+00A0) in place of spaces
 *  ("Charter fee\u00a0for the above period"). Same length, so offsets survive. */
export function norm(raw: string): string { return (raw ?? "").replace(/\u00a0/g, " "); }

// ----------------------------------------------------------------- blocks

export type YachtBlock = {
  /** Name as written in the header (prefix removed). */
  name: string;
  key: string;
  /** The type prefix the supplier wrote (M/Y, S/Y, M/S, ...) or null. */
  prefix: string | null;
  /** The whole header line, verbatim. */
  header: string;
  start: number;
  end: number;
  /** This yacht's own slice of the email: header through to the next header. */
  text: string;
};

// A header line: optional bullet/number, optional markdown noise the Gmail
// import leaves in front (an inline image "![](cid:...)", bold "**"), then a
// type prefix, then the name. Anchored to line start so a prefix mentioned
// mid-sentence is not a header. Lines beginning with ">" are quoted history
// (the broker's own request echoed back) and are never headers. Only the
// symbol prefixes count: the words "Motor Yacht" in prose ("Motor Yacht or
// Sailing Catamaran") produced a phantom yacht called "or" on a live run.
const HEADER_RE =
  /^[ \t]*(?:[-*•·]+[ \t]*)?(?:\d{1,2}[.)][ \t]*)?(?:!\[[^\]]*\]\([^)]*\)[ \t]*)*(?:\*\*)?(M\/Y|S\/Y|M\/S|M\/C|S\/C|P\/C|M\.Y\.|S\.Y\.|M\.S\.)(?:\*\*)?[ \t:.\-–—]+([^\n]{2,})$/gim;

// Words that begin the MODEL part of a header, so the NAME stops before them.
const MODEL_STARTERS = new Set([
  "lagoon", "fountaine", "fp", "sunreef", "bali", "leopard", "nautitech", "heysea", "aquila", "catana",
  "outremer", "excess", "seawind", "privilege", "sanlorenzo", "benetti", "ferretti", "azimut", "princess",
  "sunseeker", "aicon", "pershing", "riva", "mangusta", "heesen", "admiral", "picchiotti", "custom",
  "beneteau", "jeanneau", "dufour", "bavaria", "hanse", "oceanis", "amel", "perini", "alloy", "cnb",
  "nautor", "swan", "gulet", "feadship", "baglietto", "sanya", "saba", "samana", "aura", "elba", "helia",
  "lucia", "astrea", "tanna", "alegria", "isla", "orana", "salina", "lipari", "mahe", "athena", "bahia",
  "belize", "eleuthera", "ipanema", "victoria", "power", "seventy", "sixty", "fifty", "forty", "catamaran",
  "motor", "sailing", "yacht", "model", "built", "build", "year", "refit",
]);

function nameFromHeaderRest(rest: string): string {
  // Bold runs first ("**S/Y LUCKY** **CLOVER** - ..."), then cut at an explicit
  // separator: ", " " - " " | " "(" ":".
  const flat = rest.replace(/\*\*/g, " ").replace(/[ \t]+/g, " ").trim();
  let head = flat.split(/\s*[|(:]\s*|\s+[-–—]\s+|,\s*/)[0] ?? flat;
  head = head.trim();
  const tokens = head.split(/\s+/);
  const out: string[] = [];
  for (const t of tokens) {
    const low = t.toLowerCase().replace(/[^a-z0-9']/g, "");
    if (!low) break;
    if (out.length && MODEL_STARTERS.has(low)) break;            // "ASTORIA FP Samana 59"
    if (out.length && /^\d{4}$/.test(low)) break;                 // a year
    if (out.length && /^\d+(\.\d+)?(m|ft|'|meters?)$/.test(low)) break; // a length
    if (out.length && /^\d+(\.\d+)?$/.test(low) && out.join(" ").length > 2) break; // "Lagoon 52" style number after a real name
    out.push(t.replace(/[,:;–—-]+$/g, ""));
    if (out.length >= 5) break;
  }
  return out.join(" ").trim();
}

/** Every yacht header in the email, in order, each with its own text slice.
 *  Returns [] when the email uses no recognisable headers - callers must then
 *  say "could not count", never "all present". */
export function detectYachtBlocks(raw: string): YachtBlock[] {
  const text = norm(raw);
  const hits: { index: number; prefix: string; rest: string; line: string }[] = [];
  for (const m of text.matchAll(HEADER_RE)) {
    const idx = m.index ?? 0;
    hits.push({ index: idx, prefix: m[1], rest: m[2], line: m[0].trim() });
  }
  const blocks: YachtBlock[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const name = nameFromHeaderRest(h.rest);
    const key = yachtKey(name);
    if (!key) continue;
    const start = h.index;
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
    if (seen.has(key)) continue; // the same header again = a quoted copy; the block before it already ended here
    seen.add(key);
    blocks.push({ name, key, prefix: h.prefix.toUpperCase().replace(/\./g, ""), header: h.line, start, end, text: text.slice(start, end) });
  }
  return blocks;
}

/** Names from lines that carry the fleet-list signature "N guests ... N
 *  cabins" whether or not a type prefix is written ("SELENE– Model Lagoon 620
 *  - 18,90 m / 62 ft | 2015 built | 10 guests | 5 double cabins | 3 crew" had no
 *  prefix and was the 27th yacht nobody counted). Quoted lines are skipped. */
const TYPE_WORDS = /^(?:proposal\s+[a-z]\b[\s:.)-]*|option\s+[a-z0-9]\b[\s:.)-]*|[a-d][).]\s*)?(?:(?:sailing|power|motor)\s+(?:catamaran|yacht|sailer)|catamaran|m\/y|s\/y|m\/s|m\.y\.|s\.y\.)?[\s:.\-–—]*/i;
const NOT_A_NAME = /^(?:view|yacht brochure|brochure pdf|360|walkthrough|accommodation|additional|water toys?|available dates|port|rates?\b|high season|mid season|low season|plus|charter fee|https?:)/i;

export function detectHeaderLikeNames(raw: string): string[] {
  const out: string[] = []; const seen = new Set<string>();
  const lines = norm(raw).split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith(">") || /\bwrote:\s*$/i.test(line)) continue;
    if (!/\b\d{1,2}\s*guests?\b/i.test(line) || !/\b\d{1,2}\s*(?:double\s+|twin\s+|guest\s+)?cabins?\b/i.test(line)) continue;
    let rest = line.replace(/^(?:[-*•·]+\s*)?(?:\d{1,2}[.)]\s*)?(?:!\[[^\]]*\]\([^)]*\)\s*)*(?:\*\*)?/, "");
    const hadPrefix = /^(M\/Y|S\/Y|M\/S|M\/C|S\/C|P\/C|M\.Y\.|S\.Y\.|M\.S\.)(?:\*\*)?[ \t:.\-–—]+/i.test(rest);
    rest = rest.replace(/^(M\/Y|S\/Y|M\/S|M\/C|S\/C|P\/C|M\.Y\.|S\.Y\.|M\.S\.)(?:\*\*)?[ \t:.\-–—]+/i, "");
    let name = nameFromHeaderRest(rest);
    // Some suppliers put the NAME on its own line above the model line:
    //   "SAILING CATAMARAN SEABARIT LX"
    //   "MOON 60 | BUILT 2024 | 10 GUESTS | 5 GUEST CABINS | CREW OF 3"
    // Only when the signature line itself carries no name (no prefix, and it
    // opens with a builder/model word or a number) do we take the short line
    // above, stripped of type words. A prefixed header is never overridden.
    const toks = rest.replace(/\*\*/g, " ").trim().split(/\s+/);
    const weak = !hadPrefix && (MODEL_STARTERS.has((toks[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")) || /^\d/.test(toks[0] ?? "") || /^\d+$/.test((toks[1] ?? "").replace(/[^0-9]/g, "") || "x"));
    if (weak) {
      for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
        const above = (lines[k] ?? "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\*\*/g, " ").trim();
        if (!above) continue;
        if (above.length > 60 || above.includes("|") || NOT_A_NAME.test(above) || /\bwrote:/i.test(above)) break;
        const cand = above.replace(TYPE_WORDS, "").replace(/[\s:.\-–—]+$/, "").trim();
        if (/[A-Za-z]/.test(cand) && cand.length >= 2 && cand.length <= 40) name = cand;
        break;
      }
    }
    const key = yachtKey(name);
    if (!key || key.length < 2 || seen.has(key)) continue;
    seen.add(key); out.push(name);
  }
  return out;
}

/** Blocks anchored on NAMES rather than headers, for emails whose yacht lines
 *  carry no M/Y prefix at all ("ARKTOS - Lagoon 52F (2020)", "Lagoon 52F
 *  ARKTOS"). The names come from the model's title scan and from the yachts
 *  already extracted. Each name's first occurrence AT A LINE START opens its
 *  block (a mention inside a sentence is used only when there is no line of
 *  its own), the next block's start closes it. Header blocks are kept; anchored
 *  ones fill the gaps, and every block's end is recomputed against its real
 *  neighbour, so a header block no longer swallows the undetected yachts
 *  beneath it. The live case: 9 headers recognised out of 31, one of them the
 *  word "or"; the format of the email is not something to guess at. */
export function anchorBlocks(raw: string, names: string[], headerBlocks: YachtBlock[] = []): YachtBlock[] {
  const text = norm(raw);
  const byKey = new Map<string, YachtBlock>();
  for (const b of headerBlocks) byKey.set(b.key, { ...b });
  const esc = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  // A line belongs to ONE yacht. Longer names claim first ("ADARA NEXT" before
  // "ADARA"), and a name never anchors on a line another yacht already owns -
  // otherwise ADARA would sit on ADARA NEXT's line and read its rates.
  const claimed = new Set<number>(headerBlocks.map((b) => b.start));
  const ordered = [...names].map((n) => (n ?? "").trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of ordered) {
    const key = yachtKey(name);
    if (!key || key.length < 2 || byKey.has(key)) continue;
    const atLineStart = new RegExp(
      `^[ \\t]*(?:[-*•·]+[ \\t]*)?(?:\\d{1,2}[.)][ \\t]*)?(?:!\\[[^\\]]*\\]\\([^)]*\\)[ \\t]*)*(?:\\*\\*)?(?:(?:M\\/Y|S\\/Y|M\\/S|M\\/C|S\\/C|P\\/C|M\\.Y\\.|S\\.Y\\.)(?:\\*\\*)?[ \\t:.\\-–—]+)?(?:\\*\\*)?(?:"|“)?${esc(name)}(?=$|[^A-Za-z0-9])`, "gim");
    const anywhere = new RegExp(`(^|[^A-Za-z0-9])${esc(name)}(?=$|[^A-Za-z0-9])`, "gi");
    let start = -1;
    for (const m of text.matchAll(atLineStart)) { if (!claimed.has(m.index ?? -1)) { start = m.index ?? -1; break; } }
    if (start < 0) {
      for (const m2 of text.matchAll(anywhere)) {
        const ls = text.lastIndexOf("\n", (m2.index ?? 0) + m2[1].length) + 1;
        if (!claimed.has(ls)) { start = ls; break; }
      }
    }
    if (start < 0) continue;
    claimed.add(start);
    const le = text.indexOf("\n", start);
    const header = text.slice(start, le < 0 ? text.length : le).trim();
    const pm = header.match(/^\s*(?:[-*•·>]+\s*)?(?:\d{1,2}[.)]\s*)?(M\/Y|S\/Y|M\/S|M\/C|S\/C|P\/C)\b/i);
    byKey.set(key, { name, key, prefix: pm ? pm[1].toUpperCase() : null, header, start, end: text.length, text: "" });
  }
  const all = [...byKey.values()].sort((a, b) => a.start - b.start);
  // Stop points: where a reply quotes the offer back ("On ... wrote:", "-----
  // Original message-----", "From:"), and every REPEATED header of any yacht.
  // Without them the last block runs into the quoted copy and reads every
  // yacht's rates as its own.
  const stops: number[] = [];
  for (const m of text.matchAll(/^(?:(?:\\?-){3,}\s*Original message|On [^\n]{5,160} wrote:|From:\s+[^\n]{3,120}\n|(?:\*\*)?(?:charter rates|general (?:terms|conditions)|terms (?:and|&(?:amp;)?) conditions|payment terms|price list \d{4}|our \d{4} magazine)\b)/gim)) stops.push(m.index ?? 0);
  for (const b of all) {
    const re = new RegExp(`^[ \\t]*(?:[-*•·]+[ \\t]*)?(?:!\\[[^\\]]*\\]\\([^)]*\\)[ \\t]*)*(?:\\*\\*)?(?:(?:M\\/Y|S\\/Y|M\\/S|M\\/C|S\\/C|P\\/C)(?:\\*\\*)?[ \\t:.\\-–—]+)?(?:\\*\\*)?${esc(b.name)}(?=$|[^A-Za-z0-9])`, "gim");
    for (const m of text.matchAll(re)) if ((m.index ?? 0) !== b.start) stops.push(m.index ?? 0);
  }
  stops.sort((a, b) => a - b);
  for (let i = 0; i < all.length; i++) {
    let end = i + 1 < all.length ? all[i + 1].start : text.length;
    const stop = stops.find((x) => x > all[i].start && x < end);
    if (stop !== undefined) end = stop;
    all[i].end = end;
    all[i].text = text.slice(all[i].start, end);
  }
  return all;
}

/** Group consecutive blocks into extraction-sized chunks. The preamble before
 *  the first header rides with the first chunk (it often carries the season
 *  legend or the sender's general terms). */
export function chunkBlocks(raw: string, blocks: YachtBlock[], maxPerChunk = 8): { text: string; names: string[] }[] {
  if (!blocks.length) return [{ text: raw, names: [] }];
  const out: { text: string; names: string[] }[] = [];
  const preamble = raw.slice(0, blocks[0].start).trim();
  for (let i = 0; i < blocks.length; i += maxPerChunk) {
    const group = blocks.slice(i, i + maxPerChunk);
    let text = raw.slice(group[0].start, group[group.length - 1].end);
    if (i === 0 && preamble) text = `${preamble}\n\n${text}`;
    out.push({ text, names: group.map((b) => b.name) });
  }
  return out;
}

// ----------------------------------------------------------------- amounts

/** "48,000" "48.000" "43000" "48,000.00" -> 48000. null when not a rate-sized
 *  whole number (a stray "6,5" is a percentage, not a fee). */
export function parseAmount(s: string): number | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  // Strip a decimal ".00"/",00" tail, then all thousands separators.
  const noDec = t.replace(/[.,]00\b$/, "");
  const digits = noDec.replace(/[.,\s]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return n >= 1000 ? n : null;
}

// ----------------------------------------------------------------- months

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** "June 15th to Sept 15th" / "15 June - 15 September" -> a day-level window. */
export function parseDaySpan(text: string): { from: DayInYear; to: DayInYear } | null {
  const t = (text ?? "").toLowerCase();
  const M = "(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)";
  const D = "(\\d{1,2})(?:st|nd|rd|th)?";
  const re1 = new RegExp(`\\b${M}\\s*${D}\\s*(?:-|–|—|to|until|till|through)\\s*${M}\\s*${D}\\b`);
  const re2 = new RegExp(`\\b${D}\\s*${M}\\s*(?:-|–|—|to|until|till|through)\\s*${D}\\s*${M}\\b`);
  let m = t.match(re1);
  if (m) return { from: { m: MONTHS[m[1]], d: Number(m[2]) }, to: { m: MONTHS[m[3]], d: Number(m[4]) } };
  m = t.match(re2);
  if (m) return { from: { m: MONTHS[m[2]], d: Number(m[1]) }, to: { m: MONTHS[m[4]], d: Number(m[3]) } };
  return null;
}

/** "July - August" -> [7,8]; "October - May" -> [10,11,12,1,2,3,4,5];
 *  "June & September" / "June and Sept" -> [6,9]; "rest months" -> [] (the
 *  caller fills the complement). Unknown text -> []. */
export function parseMonths(text: string): number[] {
  const t = (text ?? "").toLowerCase();
  const found: { m: number; at: number }[] = [];
  for (const m of t.matchAll(/\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/g)) {
    found.push({ m: MONTHS[m[1]], at: m.index ?? 0 });
  }
  if (!found.length) return [];
  // A range: exactly two months joined by "-", "to", "–", "—", "until", "through".
  if (found.length === 2) {
    const between = t.slice(found[0].at, found[1].at);
    if (/[-–—]|\bto\b|\buntil\b|\bthrough\b|\btill\b/.test(between) && !/&|\band\b|,|\//.test(between)) {
      const a = found[0].m, b = found[1].m;
      const out: number[] = [];
      let x = a;
      for (let guard = 0; guard < 12; guard++) { out.push(x); if (x === b) break; x = (x % 12) + 1; }
      return out;
    }
  }
  return Array.from(new Set(found.map((f) => f.m)));
}

// ----------------------------------------------------------------- seasons

export type SeasonTier = "high" | "mid" | "low" | "other";
export type DayInYear = { m: number; d: number };
export type ParsedSeasonRate = {
  season: SeasonTier;
  /** True when this tier's months were not stated and were filled as the
   *  complement of the others ("rest months"): it is the fallback for any
   *  night no explicit window covers, at DAY level. */
  rest?: boolean;
  /** Day-level window when the email gave one ("June 15th to Sept 15th");
   *  wraps over the new year when to < from. months[] then lists the months
   *  it touches, for display; the selection uses the days. */
  span?: { from: DayInYear; to: DayInYear };
  /** The label as the supplier wrote it, e.g. "High Season (July - August)". */
  label: string;
  /** Calendar months (1-12) this rate applies to; [] when the email did not say. */
  months: number[];
  weekly: number;
  /** The exact line it came from. */
  snippet: string;
};

const WEEKLY_AMOUNT_RE =
  /(?:€|eur|euro)?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]00)?|\d{4,6})\s*(?:€|eur|euro)?\s*(?:\/|per\s+)\s*(?:week|wk|w)\b/i;

function tierOf(line: string): SeasonTier | null {
  const l = line.toLowerCase();
  if (/\b(high|peak)\s*season\b|\bhigh\b.*\bseason\b/.test(l)) return "high";
  if (/\b(mid|middle|shoulder)\s*season\b|\bmid\b.*\bseason\b/.test(l)) return "mid";
  if (/\blow\s*season\b|\blow\b.*\bseason\b|rest\s+(?:of\s+)?(?:the\s+)?(?:months|year|season)/.test(l)) return "low";
  return null;
}

/** All weekly season rates stated in one yacht's text. Only lines that carry a
 *  per-week amount count; a bare number never becomes a rate. */
export function parseSeasonRates(text: string): ParsedSeasonRate[] {
  const lines = norm(text).split(/\r?\n/);
  const out: ParsedSeasonRate[] = [];
  const seen = new Set<string>();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const tier = tierOf(line);
    let m = line.match(WEEKLY_AMOUNT_RE);
    // "Low Season: EURO 21000 (rest months)" - no "/week", but a season label
    // AND a currency marker make it a rate all the same.
    if (!m && tier) m = line.match(/(?:€|eur|euro)\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]00)?|\d{4,6})\b|(\d{1,3}(?:[.,]\d{3})+(?:[.,]00)?|\d{4,6})\s*(?:€|eur|euro)\b/i);
    if (!m) continue;
    const weekly = parseAmount(m[1] ?? m[2]);
    if (weekly === null) continue;
    // Months: prefer the parenthetical, else the label text before the amount.
    const paren = line.match(/\(([^)]*)\)/)?.[1] ?? "";
    const before = line.slice(0, m.index ?? 0);
    const span = parseDaySpan(paren) ?? parseDaySpan(before);
    let months = parseMonths(paren);
    if (!months.length) months = parseMonths(before);
    const labelSrc = before.replace(/[:\s]+$/, "").trim();
    const label = (labelSrc || (tier ? `${tier[0].toUpperCase()}${tier.slice(1)} season` : "Weekly rate")).slice(0, 60);
    const sig = `${tier ?? label.toLowerCase()}|${weekly}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ season: tier ?? "other", label, months, weekly, snippet: line.slice(0, 160), ...(span ? { span } : {}) });
  }
  // "rest months" / a tier with no months gets the complement of the others,
  // but ONLY when the others actually named their months (never assume).
  const named = out.filter((r) => r.months.length);
  const unnamed = out.filter((r) => !r.months.length);
  if (named.length && unnamed.length === 1) {
    const used = new Set(named.flatMap((r) => r.months));
    const rest: number[] = [];
    for (let mth = 1; mth <= 12; mth++) if (!used.has(mth)) rest.push(mth);
    if (rest.length) { unnamed[0].months = rest; unnamed[0].rest = true; }
  }
  return out;
}

// ----------------------------------------------------------------- rate year

/** The year the supplier says the rates are for ("RATES 2027", "2027 rates",
 *  "prices for 2027"), else null. */
export function parseRateYear(text: string): number | null {
  const t = text ?? "";
  const m =
    t.match(/\brates?\s*(?:for\s*)?(20\d{2})\b/i) ??
    t.match(/\b(20\d{2})\s*(?:season\s*)?rates?\b/i) ??
    t.match(/\bprices?\s*(?:for\s*)?(20\d{2})\b/i) ??
    t.match(/\b(20\d{2})\s*prices?\b/i);
  return m ? Number(m[1]) : null;
}

// ----------------------------------------------------------------- APA / VAT

export type VatByArea = { area: string; pct: number; snippet: string };

function pct(s: string): number | null {
  const n = Number((s ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** APA % and VAT % as written; VAT that depends on the cruising area comes
 *  back as a list ("7,8% for Argosaronic Gulf; 6,5% for Cyclades"). */
export function parseApaVat(text: string): { apa_pct: number | null; apa_snippet: string; vat_pct: number | null; vat_snippet: string; vat_by_area: VatByArea[] } {
  const t = norm(text);
  // The figure may follow the word ("APA 25%", "V.A.T. 6,5%") or precede it
  // ("6,5% VAT", "12% VAT"). Take whichever sits closest to the word; the old
  // after-only reading turned "6,5% VAT & APA 25%" into VAT 25.
  const nearest = (word: RegExp, src: string): { v: number; snip: string } | null => {
    let best: { v: number; snip: string; dist: number } | null = null;
    for (const w of src.matchAll(word)) {
      const wi = w.index ?? 0, we = wi + w[0].length;
      const afterSrc = src.slice(we, we + 30);
      const after = afterSrc.match(/^[^%\n\d]{0,20}?(\d{1,2}(?:[.,]\d)?)\s*%/);
      if (after) {
        const v = pct(after[1]); const dist = after[0].indexOf(after[1]); // chars between the word and the figure
        if (v !== null && (!best || dist < best.dist)) best = { v, snip: src.slice(wi, we + after[0].length), dist };
      }
      const beforeSrc = src.slice(Math.max(0, wi - 12), wi);
      const before = beforeSrc.match(/(\d{1,2}(?:[.,]\d)?)\s*%\s*$/);
      if (before) {
        const v = pct(before[1]); const dist = beforeSrc.length - ((before.index ?? 0) + before[1].length); // chars between the figure and the word
        if (v !== null && (!best || dist < best.dist)) best = { v, snip: src.slice(wi - (beforeSrc.length - (before.index ?? 0)), we), dist };
      }
    }
    return best ? { v: best.v, snip: best.snip } : null;
  };
  let apa_pct: number | null = null, apa_snippet = "";
  const apa = nearest(/\bAPA\b/gi, t);
  if (apa) { apa_pct = apa.v; apa_snippet = apa.snip; }

  const vat_by_area: VatByArea[] = [];
  let vat_pct: number | null = null, vat_snippet = "";
  // Every VAT mention on its line.
  for (const line of t.split(/\r?\n/)) {
    if (!/\bV\.?A\.?T\.?\b/i.test(line)) continue;
    const pairs = [...line.matchAll(/(\d{1,2}(?:[.,]\d)?)\s*%\s*(?:for|in|within)\s+(?:the\s+)?([A-Za-z][A-Za-z\- ]{2,40}?)(?=\s*[;,.)]|\s*$|\s+(?:and|&)\b)/gi)];
    if (pairs.length >= 2) {
      for (const p of pairs) {
        const v = pct(p[1]);
        if (v !== null) vat_by_area.push({ area: p[2].trim(), pct: v, snippet: line.trim().slice(0, 160) });
      }
      continue;
    }
    if (vat_pct === null) {
      const vm = nearest(/\bV\.?A\.?T\.?\b/gi, line);
      if (vm) { vat_pct = vm.v; vat_snippet = vm.snip; }
    }
  }
  return { apa_pct, apa_snippet, vat_pct, vat_snippet, vat_by_area };
}

const AREA_FAMILIES: { family: string; words: RegExp }[] = [
  { family: "saronic", words: /\b(argo[\s-]?saronic|saronic|athens|athina|aegina|hydra|spetses|poros|peloponnese)\b/i },
  { family: "cyclades", words: /\b(cyclades|cycladic|mykonos|santorini|paros|naxos|milos|syros|sifnos|serifos|ios|folegandros|koufonisia|amorgos|tinos|andros|kea)\b/i },
  { family: "ionian", words: /\b(ionian|corfu|kerkyra|lefkada|lefkas|kefalonia|cephalonia|zakynthos|zante|ithaca|paxos)\b/i },
  { family: "dodecanese", words: /\b(dodecanese|rhodes|rhodos|kos|patmos|symi|leros|kalymnos)\b/i },
  { family: "sporades", words: /\b(sporades|skiathos|skopelos|alonissos|volos)\b/i },
];

function areaFamily(s: string): string | null {
  for (const f of AREA_FAMILIES) if (f.words.test(s ?? "")) return f.family;
  return null;
}

/** Resolve a conditional VAT from the request's area. Exactly one match or
 *  nothing - a doubtful match is not a match. */
export function pickVatForArea(vatByArea: VatByArea[], requestArea?: string | null): VatByArea | null {
  const fam = areaFamily(requestArea ?? "");
  if (!fam) return null;
  const hits = vatByArea.filter((v) => areaFamily(v.area) === fam);
  return hits.length === 1 ? hits[0] : null;
}

// ----------------------------------------------------------------- type

const POWER_CAT_MODELS =
  /\b(heysea|aquila|lagoon\s*(?:sixty\s*7|seventy\s*8|67|78)|fp\s*my\s*\d|my\s*(?:37|40|44|4\.?s|6)\b|leopard\s*(?:43|46|51|53)\s*pc|sunreef\s*\d+\s*power|power\s*cat(?:amaran)?|\bpc\b)\b/i;

export type TypeConflict = { prefix: string; reason: string; snippet: string };

/** "S/Y" written on a power catamaran, or "M/Y" on something the supplier
 *  themselves calls a sailing yacht: the prefix and the model contradict.
 *  Deliberately narrow. Many brokers write M/Y on every catamaran they list,
 *  sailing ones included (a fleet email did it on 22 of 27) - that is a house
 *  convention, not an error, and blanking 22 types would cost the broker far
 *  more than it protects. The case that misleads a client is the one George
 *  found: S/Y on a HeySea power catamaran. */
export function detectTypeConflict(prefixOrType: string | null | undefined, modelText: string): TypeConflict | null {
  const p = (prefixOrType ?? "").toUpperCase().replace(/\./g, "").trim();
  const t = modelText ?? "";
  const isSail = /^S\/?Y$|SAILING YACHT/.test(p);
  const isMotor = /^M\/?Y$|MOTOR YACHT/.test(p);
  if (!isSail && !isMotor) return null; // M/S, M/C, S/C, P/C are not contradictions we can call
  const power = POWER_CAT_MODELS.test(t) || /\bmotor\s*yacht\b/i.test(t);
  const saysSail = /\bsailing\s*(?:yacht|catamaran|cat)\b/i.test(t);
  if (isSail && power && !saysSail) {
    return { prefix: p, reason: "written as S/Y but the model is a power catamaran / motor yacht", snippet: t.trim().slice(0, 160) };
  }
  if (isMotor && saysSail && !power) {
    return { prefix: p, reason: "written as M/Y but the supplier describes it as a sailing yacht / sailing catamaran", snippet: t.trim().slice(0, 160) };
  }
  return null;
}

// ----------------------------------------------------------------- dates

export type RateSelection =
  | { kind: "single"; rate: ParsedSeasonRate; nights: number }
  | { kind: "split"; total: number; nights: number; segments: { rate: ParsedSeasonRate; nights: number; amount: number }[] }
  | { kind: "none"; reason: string };

function parseISODate(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Which tier the charter falls in. Every night is placed by its calendar
 *  month; if all nights share one tier that tier's weekly rate is the answer;
 *  if they straddle, the pro-rata George specified: each tier's weekly / 7 x
 *  its nights, summed, rounded once to the euro. A night that no tier covers
 *  means "none" - the supplier did not price that month. */
export function selectRateForDates(rates: ParsedSeasonRate[], fromISO?: string | null, toISO?: string | null): RateSelection {
  const from = parseISODate(fromISO), to = parseISODate(toISO);
  if (!from || !to) return { kind: "none", reason: "charter dates not set" };
  const nights = Math.round((to.getTime() - from.getTime()) / 86400000);
  if (nights <= 0 || nights > 60) return { kind: "none", reason: "charter dates do not form a stay" };
  const priced = rates.filter((r) => (r.months.length || r.span) && r.weekly > 0);
  const inSpan = (r: ParsedSeasonRate, month: number, day: number): boolean => {
    if (!r.span) return r.months.includes(month);
    const v = month * 100 + day, a = r.span.from.m * 100 + r.span.from.d, b = r.span.to.m * 100 + r.span.to.d;
    return a <= b ? v >= a && v <= b : v >= a || v <= b; // wraps over the new year
  };
  // A tier without its own window ("rest months") covers whatever the windowed
  // tiers do not - checked after the explicit ones.
  const explicit = priced.filter((r) => !r.rest), restTier = priced.find((r) => r.rest);
  if (!priced.length) return { kind: "none", reason: "season months not stated" };
  const perRate = new Map<ParsedSeasonRate, number>();
  for (let i = 0; i < nights; i++) {
    const d = new Date(from.getTime() + i * 86400000);
    const month = d.getUTCMonth() + 1, day = d.getUTCDate();
    const r = explicit.find((x) => x.span && inSpan(x, month, day)) ?? explicit.find((x) => !x.span && inSpan(x, month, day)) ?? restTier;
    if (!r) return { kind: "none", reason: `no rate covers ${d.toISOString().slice(0, 10)}` };
    perRate.set(r, (perRate.get(r) ?? 0) + 1);
  }
  if (perRate.size === 1) {
    const [rate] = perRate.keys();
    return { kind: "single", rate, nights };
  }
  const segments = [...perRate.entries()].map(([rate, n]) => ({ rate, nights: n, amount: (rate.weekly / 7) * n }));
  const total = Math.round(segments.reduce((s, x) => s + x.amount, 0));
  return { kind: "split", total, nights, segments: segments.map((s) => ({ ...s, amount: Math.round(s.amount) })) };
}

/** Month numbers as the short names a broker reads at a glance. */
export function monthsLabel(months: number[]): string {
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months.map((m) => names[m] ?? String(m)).join(", ");
}
