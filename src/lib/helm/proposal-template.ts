// src/lib/helm/proposal-template.ts
// =============================================================
// The Helm — proposal HTML builder. 1:1 port of render_single /
// render_combined / base_css / helpers from
// render-kit/scripts/build_proposal.py. CSS is copied VERBATIM —
// it is what produces the look (navy/gold/ivory, Cinzel/Cormorant/
// Montserrat, metallic-gold gradient via -webkit-background-clip,
// scrims, diamond rules). DO NOT restyle here.
//
// Pure: returns an HTML string. The Chromium render lives in render.ts.
// Images arrive as URLs (George-hosted or white-label supplier links
// that passed the branding check) or as data: URIs; null → placeholder.
// =============================================================

import { computePricing, fmtEur, type PricingInput } from "./pricing";
import { FONT_FACE_CSS } from "./fonts.generated";

// ----------------------------------------------------------------- types
export type Images = Record<string, string | null | undefined>;

export type SingleYacht = {
  name: string;
  type?: string;
  spec_line?: string;
  period_line?: string;
  /** "Athens -> Mykonos · 25 June - 3 July" line (embark/disembark + dates). */
  voyage_line?: string;
  price_sub?: string;
  experience_title?: string;
  experience_paras?: string[];
  highlights?: string[];
  accommodation?: [string, string][];
  crew_line?: string;
  water_toys?: string[];
  tech_specs?: [string, string][];
  pricing?: PricingInput;
  gallery?: (string | null)[];
  gallery_slots?: number;
  links?: Record<string, string>;
  images?: Images;
};

/** Charter product type. `weekly` (default) = the original crewed-weekly render
 *  path (APA / VAT / MYBA 50-50 / crew gratuity). The other three rewrite the
 *  boilerplate + money box and never emit APA / MYBA / crew-gratuity wording.
 *  Additive + backward-compatible: an old stored proposal with NO charter_type
 *  is treated EXACTLY as `weekly`, byte-for-byte. */
export type CharterType = "weekly" | "bareboat" | "daily" | "custom";

/** OWNER-SELECTABLE last-page terms. Optional + additive: when absent/empty the
 *  last page falls back to the EXISTING per-charter_type default text (so weekly
 *  and every stored proposal render byte-identically). When provided, ONLY the
 *  present sections render — each absent section is omitted. Persisted in
 *  extraction.terms; no DB migration. */
export type Terms = {
  included?: string[];           // "What is included" bullet lines
  not_included?: string[];       // "Not included" bullet lines
  obligatory_extras?: string[];  // "Payable at base / obligatory extras" lines
  free_onboard?: string[];       // "Complimentary on board" lines
  security_deposit?: string;     // e.g. "EUR 3,000 refundable, payable at base by card"
  payment?: string;              // e.g. "50% within 5 days of booking; balance 30 days before embarkation"
  skipper?: string;              // e.g. "Skipper licence required; professional skipper on request"
  cancellation?: string;         // free text
  notes?: string;                // extra free text
};

export type SingleProposal = {
  mode: "single";
  no_myba?: boolean;
  show_ghost_credit?: boolean;
  /** Travel-agent white-label: neutral footer, no George identity/colophon. */
  white_label?: boolean;
  /** Charter product type — default/undefined = weekly (unchanged render). */
  charter_type?: CharterType;
  /** Optional broker note on crew/extras, rendered verbatim for ALL types. */
  crew_note?: string;
  /** OWNER-SELECTABLE last-page terms. Absent/empty => existing default text. */
  terms?: Terms;
  yacht: SingleYacht;
};

/** PER-YACHT bareboat extras — OPTIONAL + additive. These belong to ONE yacht
 *  (not the proposal) and render compactly INSIDE that yacht's money box (never
 *  on the last page). A yacht with none of these renders exactly as before, so
 *  the weekly/crewed flow is byte-identical when they are unset. Each yacht
 *  carries its OWN values (Vernicos-style bareboat: "Payable at base",
 *  "Security deposit", complimentary on-board items). NOTE: commission /
 *  "price to agency" is INTERNAL and is NEVER part of this shape — only the
 *  client-facing charter fee (post-discount) ever reaches the template. */
export type PayableAtBase = { label: string; amount?: string };

export type CombinedYacht = {
  name: string;
  type?: string;
  tier_label?: string;
  spec_line?: string;
  /** "Athens -> Mykonos · 25 June - 3 July" line (embark/disembark + dates). */
  voyage_line?: string;
  spec_strip?: [string, string][];
  description?: string;
  inside_info?: string;
  /** Optional muted note under the dates cell, e.g. why this yacht's window or
   *  port differs from the requested brief. Absent => nothing renders. */
  date_note?: string;
  /** ONE sentence on the crew (roles, size, credentials - NEVER personal
   *  names). Rendered with the owner-confirmation footnote. Absent => nothing. */
  crew_line?: string;
  /** Width/height ratio of the main photo, measured from its bytes at
   *  generate time. Portrait-ish (< 1.25) renders letterboxed over a blurred
   *  self-backdrop instead of cover-cropped to a mast. Absent => cover. */
  main_aspect?: number;
  /** Salon-only magazine detail (toys / layout / highlights). The PDF
   *  renderer never reads this — combined pages stay byte-identical. */
  salon_extras?: SalonExtras;
  pricing?: PricingInput;
  links?: Record<string, string>;
  images?: Images;
  /** PER-YACHT, money-box only (absent => nothing renders, weekly unchanged). */
  payable_at_base?: PayableAtBase[];   // e.g. [{label:"Charter Pack — …", amount:"EUR 250"}]
  security_deposit?: string;           // e.g. "EUR 3,000 refundable (card at base)"
  free_onboard?: string[];             // e.g. ["1 SUP","Welcome Pack","Espresso maker"]
  /** "THE DOUBLE": when the SAME yacht is quoted for 2+ durations (e.g. 5 nights
   *  AND 7 nights, different dates + fees), each option is one entry here. When
   *  present (>=1) the money box renders a compact PERIODS & RATES table INSTEAD
   *  of the single charter-fee/all-in rows. Absent => the existing single-pricing
   *  money box renders EXACTLY as before (weekly/bareboat unchanged). The figures
   *  are CLIENT-facing (post-discount); commission is NEVER here. */
  period_options?: PeriodOption[];
};

/** ONE quoted duration for a yacht in "the double". label e.g. "5 nights" /
 *  "7 nights"; dates e.g. "31 Aug – 5 Sep 2026". `fee` is the NUMERIC client
 *  (post-discount) charter fee — when set together with `apa_pct`/`vat_pct` the
 *  money box renders the FULL per-period BREAKDOWN (Charter fee / APA / VAT /
 *  ESTIMATED ALL-IN) as a comparison table. `fee_disp` is the pre-formatted
 *  fallback (e.g. "€ 15,000") used for the SIMPLE display when no APA/VAT % is
 *  set; it is also derived from `fee` when absent. `apa_pct` (e.g. 40) and
 *  `vat_pct` (e.g. 12) are the broker-set percentages — present => breakdown.
 *  `note` an optional muted sub-line e.g. "8% offer, from € 24,000". Never
 *  carries commission / price-to-agency. */
export type PeriodOption = {
  label: string;
  dates?: string;
  /** Numeric client (post-discount) charter fee. Drives the computed breakdown. */
  fee?: number;
  /** Pre-formatted fee string fallback (simple display / when `fee` is absent). */
  fee_disp?: string;
  /** Broker-set APA percentage (e.g. 40). Present (with/without vat) => breakdown. */
  apa_pct?: number;
  /** Broker-set VAT percentage (e.g. 12). Present => breakdown. */
  vat_pct?: number;
  note?: string;
};

export type CombinedProposal = {
  mode: "combined";
  no_myba?: boolean;
  show_ghost_credit?: boolean;
  /** Travel-agent white-label: neutral footer, no George identity/colophon. */
  white_label?: boolean;
  /** Charter product type — default/undefined = weekly (unchanged render). */
  charter_type?: CharterType;
  /** Optional broker note on crew/extras, rendered verbatim for ALL types. */
  crew_note?: string;
  /** OWNER-SELECTABLE last-page terms. Absent/empty => existing default text. */
  terms?: Terms;
  client_name?: string;
  period?: string;
  guests?: string;
  area?: string;
  intro_letter?: string;
  images?: Images;
  yachts: CombinedYacht[];
  /** GEORGE-WRITTEN itinerary pages (2026-07-15: auto sample weeks removed —
   *  a canned route can never cover "the client wants Syros"). He writes the
   *  legs + notes in the panel (hard char limits enforced there AND clamped
   *  server-side); the template only typesets. Absent/empty => no week pages. */
  custom_weeks?: CustomWeek[];
  /** GEORGE-WRITTEN cover sub-line (2026-07-15: the auto line printed his
   *  internal card note under the client's name). When present it renders
   *  verbatim under the cover title; empty => the guarded auto line. */
  cover_line?: string;
};

export type CustomWeek = {
  title: string;
  days: { leg: string; note: string }[];
};

/** SALON-ONLY enrichment (2026-07-16 "magazine" wave): the extraction already
 *  knows these; the PDF deliberately stays lean, but the live Salon page
 *  renders them so a client sees toys, layout and highlights without opening
 *  the brochure. The PDF renderer NEVER reads these fields. */
export type SalonExtras = {
  highlights?: string[];
  water_toys?: string[];
  accommodation?: [string, string][];
  /** Awards / competition results / press mentions, verbatim, no crew names.
   *  When present these lead the yacht's Salon page — George's "protagonist"
   *  (an awarded chef beats a paddleboard). */
  distinctions?: string[];
  /** Guest-review quotes printed in the supplier material, verbatim. */
  testimonials?: string[];
};

export type ProposalJson = SingleProposal | CombinedProposal;

// ----------------------------------------------------------------- helpers
// HTML-escape (mirrors Python html.escape(quote=True)).
function e(x: unknown): string {
  if (x === null || x === undefined) return "";
  return String(x)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const DIAMOND = "<span class='dia'>&#9670;</span>";

// Per-guest estimate (÷4 / ÷6). OFF by default: it belongs to day-charter math,
// not a weekly crewed charter, and a per-head divisor cheapens a silent-luxury
// proposal. Flip to true to restore the "Per guest, estimated ..." line on the
// single pricing page + each combined yacht card. (George brief, 3-fixes.)
const SHOW_PER_GUEST = false;

// ----------------------------------------------------------------- text cleaners
// These are pure string normalisers shared by single + combined. They are
// defensive: any malformed input degrades to the cleanest legible form rather
// than leaking a raw ISO timestamp, a wall of unpunctuated spec, or a sentence
// that stops mid-clause.

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_INDEX: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  const long = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  MONTHS_SHORT.forEach((s, i) => { m[s.toLowerCase()] = i; });
  long.forEach((s, i) => { m[s] = i; });
  m["sept"] = 8;
  return m;
})();

// Render a single date/datetime token as "5 Sep 2026" or "5 Sep 2026, 17:00".
// Accepts: ISO datetime ("2026-09-05T17:00:00", "2026-09-05 T17:00:00",
// "2026-09-05 17:00"), ISO date ("2026-09-05"), already-human strings
// ("05 Sep 2026, 17:00", "5 September 2026", "25 June"). Midnight / absent time
// is dropped. Never emits a bare "T", seconds, or a leading zero on the day.
// Anything it cannot parse is returned trimmed & space-collapsed (so a human
// string passes through intact, never worse than the input).
function cleanDate(input: string): string {
  let s = (input ?? "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, " ");

  // --- ISO-ish: starts YYYY-MM-DD, optional time (T or space separated).
  const iso = s.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+T?\s*(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i,
  );
  if (iso) {
    const [, y, mo, d, hh, mm] = iso;
    const mi = Number(mo) - 1;
    const mon = mi >= 0 && mi < 12 ? MONTHS_SHORT[mi] : mo;
    const day = String(Number(d));
    let out = `${day} ${mon} ${y}`;
    if (hh !== undefined && !(hh === "00" || (hh === "0" && mm === "00"))) {
      out += `, ${String(Number(hh)).padStart(2, "0")}:${mm}`;
    }
    return out;
  }

  // --- Human "DD Mon YYYY[, HH:MM]" / "D Month YYYY" / "25 June".
  const human = s.match(
    /^(\d{1,2})\s+([A-Za-z]+)\.?(?:\s+(\d{4}))?(?:[,\s]+T?\s*(\d{1,2}):(\d{2})(?::\d{2})?)?$/,
  );
  if (human) {
    const [, d, monRaw, y, hh, mm] = human;
    const mi = MONTH_INDEX[monRaw.toLowerCase()];
    if (mi !== undefined) {
      const mon = MONTHS_SHORT[mi];
      let out = `${String(Number(d))} ${mon}`;
      if (y) out += ` ${y}`;
      if (hh !== undefined && !(hh === "00" && mm === "00")) {
        out += `, ${String(Number(hh)).padStart(2, "0")}:${mm}`;
      }
      return out;
    }
  }

  // --- Strip a stray trailing ISO time fragment off an otherwise human string,
  // and any bare "T17:00:00" → "17:00".
  s = s
    .replace(/\bT(\d{1,2}:\d{2})(?::\d{2})?\b/gi, "$1")
    .replace(/(\d{1,2}:\d{2}):\d{2}\b/g, "$1")
    // Strip an ISO datetime separator "T" only when it sits BETWEEN digits
    // (e.g. "2026-08-31T12:00"). The digit lookbehind stops it from eating the
    // legitimate trailing "T" of an uppercased month — "AUGUST 2026" was being
    // turned into "AUGUS 2026" on the cover because "T" was followed by " 2026".
    .replace(/(?<=\d)[ ]?T[ ]?(?=\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

// Clean every date token inside a free-text range like
// "25 June - 3 July" or "2026-09-05T17:00:00 - 2026-09-12T17:00:00".
// Splits on a dash separator (with spaces), cleans each side, rejoins with " – ".
function cleanDateRange(input: string): string {
  const s = (input ?? "").trim();
  if (!s) return "";
  const parts = s.split(/\s+[–—-]\s+/);
  if (parts.length === 2) {
    const a = cleanDate(parts[0]);
    const b = cleanDate(parts[1]);
    if (a || b) return `${a} – ${b}`;
  }
  return cleanDate(s) || s;
}

// True when two port names are the same ignoring case, surrounding space and a
// trailing period. "Mykonos" == "mykonos " == "Mykonos."
function samePort(a: string, b: string): boolean {
  const norm = (x: string) => x.trim().replace(/\.$/, "").replace(/\s+/g, " ").toLowerCase();
  return !!a && !!b && norm(a) === norm(b);
}

// Recompose a voyage line. Source shape (from the extractor) is
// "<From> → <To> · <dates>[ (note)]". We:
//   • collapse "<Port> → <Port>" to "Round trip · <Port>" when the ports match
//   • clean the date range so no raw ISO/seconds/bare-T survives
//   • preserve a trailing parenthetical note (e.g. "(Upon owner's approval)")
// The arrow may be "→", "->", or "—>". Anything we cannot parse is passed to
// cleanDate-style space-collapsing so it never renders worse than the input.
function formatVoyage(input?: string | null): string {
  let s = (input ?? "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, " ");

  // Peel a trailing parenthetical note so it survives untouched.
  let note = "";
  const noteM = s.match(/\s*(\([^()]*\))\s*$/);
  if (noteM) { note = " " + noteM[1]; s = s.slice(0, noteM.index).trim(); }

  // Split route from dates on the middot (·) if present.
  let route = s;
  let dates = "";
  const dotIdx = s.indexOf("·");
  if (dotIdx !== -1) {
    route = s.slice(0, dotIdx).trim();
    dates = s.slice(dotIdx + 1).trim();
  }

  // Parse the route around an arrow token.
  const arrowM = route.match(/^(.*?)\s*(?:→|—>|->|–>|>)\s*(.*)$/);
  let routeOut = route;
  if (arrowM) {
    const from = arrowM[1].trim();
    const to = arrowM[2].trim();
    routeOut = samePort(from, to)
      ? `Round trip · ${from}`
      : `${from} → ${to}`;
  }

  const datesOut = dates ? cleanDateRange(dates) : "";
  const joined = datesOut ? `${routeOut} · ${datesOut}` : routeOut;
  return (joined + note).trim();
}

// Clean a spec / feature wall into " · "-separated, de-duplicated, trimmed
// tokens. Handles already-clean " | "/" · " lists AND the unpunctuated wall
// ("10 Guests 4 Cabins 2 WC Length 13.13m / 43ft Model 2008 Mainsail Batten …")
// by splitting on the existing delimiters first; if there are none we fall back
// to leaving the wall intact (we never guess word boundaries badly). Case is
// preserved as authored; only separators + dupes + whitespace are normalised.
function cleanSpecLine(input?: string | null): string {
  let s0 = (input ?? "").trim();
  if (!s0) return "";
  // Normalise the two recurring supplier-data blemishes a detail-oriented
  // client catches instantly: "8 guest" (singular) and continental decimal
  // commas in dimensions ("27,60 m" / "90,7 ft").
  s0 = s0
    .replace(/(\d)\s*guest\b(?!s)/gi, "$1 guests")
    .replace(/(\d),(\d{1,2})\s*(m|ft)\b/gi, "$1.$2 $3");
  const s = s0;
  // Split on |, ·, •, / when used as a list separator, or runs of these.
  const rawParts = s.split(/\s*[|·•]\s*/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let p of rawParts) {
    p = p.replace(/\s+/g, " ").replace(/^[\s,;:]+|[\s,;:]+$/g, "").trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  if (!out.length) return s.replace(/\s+/g, " ");
  return out.join(" · ");
}

// Trim text to the last COMPLETE sentence that fits within `cap` characters,
// so a hard cap never lands mid-word or mid-clause. A "sentence end" is . ! or ?
// optionally followed by a closing quote/paren. If no sentence boundary exists
// within the budget we fall back to the last whole word + an ellipsis (still
// never mid-word). Trailing dangling fragments such as "… the yacht." or
// "… guests to fully." (a fragment the upstream extractor cut and then bolted a
// period onto) are dropped by preferring the previous full sentence when the
// final "sentence" is suspiciously short / lacks a verb-like middle.
function trimToSentence(input: string, cap: number): string {
  let s = (input ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= cap) {
    // Even when it fits, drop a trailing dangling fragment the extractor bolted on.
    return dropDanglingTail(s);
  }
  // Find sentence-ending boundaries within the cap.
  const slice = s.slice(0, cap + 1);
  const boundary = /[.!?]["')”]?(?=\s|$)/g;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(slice)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd > 0) {
    return dropDanglingTail(s.slice(0, lastEnd).trim());
  }
  // No sentence boundary in budget → cut at last whole word, add ellipsis.
  const cut = s.slice(0, cap);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:]+$/, "");
  return safe + "…";
}

// Remove a final "sentence" that is really a cut-off fragment — e.g. ends with
// "… presents a.", "… guests to fully.", "… in the.", "Additionally, the yacht."
// The upstream extractor hard-caps the text and bolts a period on, leaving a
// dangling clause. We detect two shapes and drop the trailing fragment when a
// prior complete sentence exists to fall back to:
//   A) ends on a hard "can't-end-a-sentence" function word ("a", "the", "to",
//      "fully", "in", "with", …)
//   B) a SHORT final fragment that hangs on "<article> <noun>" with an article
//      right before the last noun and a connective/article lead ("Additionally,
//      the yacht.").
// If the WHOLE text is a single sentence that ends on a hard dangler, we strip
// the trailing dangling words instead and re-terminate cleanly.
const HARD_END_WORDS = new Set([
  "the", "a", "an", "to", "of", "for", "with", "by", "and", "but", "or",
  "in", "on", "at", "its", "their", "his", "her", "fully", "while",
]);
const LEAD_WORDS = new Set([
  "additionally", "while", "her", "his", "its", "their", "the", "a", "and",
]);
function dropDanglingTail(s: string): string {
  const t = s.trim();
  const sentences = t.match(/[^.!?]+[.!?]+["')”]?|\S[^.!?]*$/g);
  const lc = (w: string) => (w || "").toLowerCase();
  const tailWords = (sentence: string) =>
    sentence
      .replace(/[.!?"')”]+$/g, "")
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[.,;:]+$/g, ""));

  if (!sentences || sentences.length < 2) {
    // Single sentence: if it ends on a hard dangler, strip trailing dangling
    // words and re-terminate, so we never end on "… in the." / "… presents a."
    const words = tailWords(t);
    let end = words.length;
    while (end > 1 && HARD_END_WORDS.has(lc(words[end - 1]))) end--;
    if (end < words.length && end >= 3) {
      return words.slice(0, end).join(" ").replace(/[\s,;:]+$/g, "") + ".";
    }
    return t;
  }

  const last = sentences[sentences.length - 1].trim();
  const words = tailWords(last);
  const n = words.length;
  const lastW = lc(words[n - 1]);
  const prevW = lc(words[n - 2] || "");
  const endsHard = HARD_END_WORDS.has(lastW);
  const shortNounDangle = n <= 4 && HARD_END_WORDS.has(prevW) && (n <= 2 || LEAD_WORDS.has(lc(words[0])));
  if (endsHard || shortNounDangle) {
    return sentences.slice(0, -1).join("").trim();
  }
  return t;
}

function imgOrPlaceholder(
  src: string | null | undefined,
  label: string,
  cls = "ph",
  h?: string,
): string {
  const style = h ? `height:${h};` : "";
  if (src) {
    return `<div class='imgwrap ${cls}' style='${style}background-image:url(${src})'></div>`;
  }
  return (
    `<div class='imgwrap ${cls} placeholder' style='${style}'>` +
    `<div class='ph-label'>${e(label)}</div></div>`
  );
}

// `foot` => push the row to the bottom of a flex-column page (`.pad-col`) so it
// sits cleanly above the absolute `.pfoot` footer and never overlaps it.
function linkButtons(links?: Record<string, string> | null, center = false, foot = false): string {
  if (!links) return "";
  // NOTE: "brochure" is intentionally NOT in this row — the Digital Brochure link
  // is rendered separately as a refined gold micro-label *inside* the pricing/deal
  // panel (see brochureLink) so it can never collide with the .pfoot footer.
  const order: [string, string][] = [
    ["gallery", "View Full Gallery"],
    ["video", "Watch Film"],
    ["details", "Yacht Details"],
  ];
  const btns: string[] = [];
  for (const [key, label] of order) {
    const url = links[key];
    if (url) btns.push(`<a class='btnlink' href='${e(url)}'>${label}</a>`);
  }
  if (!btns.length) return "";
  const cls = ["linkrow", center ? "center" : "", foot ? "foot" : ""].filter(Boolean).join(" ");
  return `<div class='${cls}'>${btns.join("")}</div>`;
}

// Digital Brochure as an understated gold micro-label (uppercase, letter-spaced,
// ~7.5pt, no box) for placement on its own line at the bottom of the pricing/deal
// panel. Uses the same ↗ glyph (&#8599;) as the GHOST credit. Renders nothing when
// the yacht has no brochure URL — no empty box, no gap change.
function brochureLink(links?: Record<string, string> | null): string {
  const url = links?.brochure;
  if (!url) return "";
  return `<a class="deal-brochure" href="${e(url)}">Digital Brochure <span class="db-arrow">&raquo;</span></a>`;
}

function galleryPage(y: SingleYacht, wl = false): string {
  const imgs = y.gallery;
  const slots = y.gallery_slots;
  if (!imgs && !slots) return "";
  const cells: string[] = [];
  if (imgs) {
    imgs.forEach((src, i) =>
      cells.push(imgOrPlaceholder(src ?? null, `Gallery ${i + 1}`, "ph", "62mm")),
    );
  } else {
    for (let i = 1; i <= Number(slots); i++) {
      cells.push(imgOrPlaceholder(null, `Gallery image ${i}`, "ph", "62mm"));
    }
  }
  return `
<div class="page"><div class="pad">
  <div class="sec-title">Gallery</div>
  <hr class="hair" style="margin:5mm 0 4mm;">
  <div class="gallery">${cells.join("")}</div>
  <div class="pfoot"><span>${confLabel(wl)}</span><span>${e(y.name)} &#8226; Gallery</span></div>
</div></div>`;
}

// Charter-agreement footnote, charter-type aware. Weekly keeps the exact MYBA
// wording (byte-identical); bareboat/daily/custom never claim the crewed MYBA
// standard contract.
function termsLabel(ct: CharterType): string {
  if (ct === "bareboat") return "Charter agreement per standard bareboat terms &amp; conditions";
  if (ct === "daily" || ct === "custom") return "Charter agreement per the operator&#8217;s standard terms &amp; conditions";
  return "Charter agreement per MYBA standard terms &amp; conditions";
}

function companyBlock(showGhost = true, terms = "Charter agreement per MYBA standard terms &amp; conditions"): string {
  let ghost = "";
  if (showGhost) {
    ghost = `
    <div style="margin-top:7mm;">
      <a href="https://ghostwebdesign.dev/" style="text-decoration:none;">
        <span class="corm" style="font-style:italic;font-size:10pt;letter-spacing:.03em;color:var(--gold-soft);">Crafted by </span><span class="cinzel" style="font-size:8.5pt;letter-spacing:.18em;color:var(--gold);">GHOST_</span><span class="corm" style="font-style:italic;font-size:10pt;letter-spacing:.03em;color:var(--gold-soft);"> - premium digital studio for the discerning few</span><span style="color:var(--gold);font-size:8.5pt;"> &#8599;</span>
      </a>
    </div>`;
  }
  return `
  <div style="margin-top:12mm;border-top:1px solid var(--hair);padding-top:6mm;text-align:center;">
    <div class="cinzel" style="font-size:13pt;letter-spacing:.16em;color:var(--ivory);">GEORGE YACHTS BROKERAGE HOUSE LLC</div>
    <div class="label dim" style="font-size:6.5pt;letter-spacing:.18em;margin-top:2mm;">
      30 N Gould St, STE R &#8226; Sheridan, WY 82801 &#8226; USA</div>
    <div class="body" style="font-size:8.5pt;margin-top:4mm;color:var(--ivory-dim);">
      georgeyachts.com &#8226; george@georgeyachts.com<br>
      Athens +30 6970380999 &#8226; Miami / WhatsApp +1 7867988798</div>
    <div class="label dim" style="font-size:5.8pt;letter-spacing:.12em;margin-top:5mm;line-height:1.6;color:var(--slate);">
      &copy; 2026 George Yachts Brokerage House LLC. Confidential and proprietary, prepared exclusively for the named recipient.
      Indicative only; not an offer or a binding contract. All rates, availability and terms are subject to a signed charter agreement.
      No part may be reproduced, distributed or forwarded without written consent.<br>
      ${terms}. Prices in EUR, estimates only.</div>
    ${ghost}
  </div>`;
}

// Travel-agent white-label footer: brand-free, no George Yachts identity, no
// address / phone / email / website / colophon. Keeps a generic confidentiality
// line and the same CSS classes so the styling matches the rest of the document.
function neutralFooter(terms = "Charter agreement per MYBA standard terms &amp; conditions"): string {
  return `
  <div style="margin-top:12mm;border-top:1px solid var(--hair);padding-top:6mm;text-align:center;">
    <div class="label dim" style="font-size:6.5pt;letter-spacing:.18em;line-height:1.8;">
      Confidential and proprietary, prepared solely for the named recipient. Indicative only; not a binding contract.<br>
      All rates and availability are subject to change until confirmed in writing &#8226; Prices in EUR, estimates only<br>
      ${terms}
    </div>
  </div>`;
}

// Footer chooser. Direct-client => the unchanged companyBlock (George Yachts +
// optional Ghost colophon). Travel-agent white-label => the neutral footer.
// The charter-agreement footnote follows the charter type (weekly => MYBA).
function footerBlock(d: { white_label?: boolean; show_ghost_credit?: boolean; charter_type?: CharterType | string | null }): string {
  const terms = termsLabel(charterType(d));
  return d.white_label ? neutralFooter(terms) : companyBlock(d.show_ghost_credit ?? true, terms);
}

// Inner-page footer-line label. Direct-client keeps the EXACT existing string;
// white-label drops the George Yachts name to stay anonymous.
function confLabel(wl?: boolean): string {
  return wl ? "Confidential" : "George Yachts &#8226; Confidential";
}

// CSS copied VERBATIM from base_css() in build_proposal.py (after the
// embedded @font-face). The one backslash escape (\25C6 for the ◆ list
// bullet) is doubled here so the emitted CSS keeps the literal "\25C6".
function baseCss(): string {
  return (
    FONT_FACE_CSS +
    "\n" +
    `
:root{
  --navy:#0D1B2A; --navy-deep:#091420; --navy-soft:#12243A;
  --gold:#C9A84C; --gold-soft:#D8C088; --ivory:#F4F1EA; --ivory-dim:#CBC8C0;
  --slate:#8A97A6; --hair:rgba(201,168,76,0.30);
}
*{margin:0;padding:0;box-sizing:border-box;}
@page{size:A4;margin:0;}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{font-family:'Montserrat',sans-serif;color:var(--ivory);background:var(--navy);}
.page{position:relative;width:210mm;height:297mm;overflow:hidden;
      background:var(--navy);page-break-after:always;}
.page:last-child{page-break-after:auto;}
.pad{position:absolute;inset:0;padding:20mm 18mm;}

/* typography */
.cinzel{font-family:'Cinzel',serif;}
.corm{font-family:'Cormorant',serif;}
.label{font-family:'Cinzel',serif;letter-spacing:.34em;text-transform:uppercase;
       font-size:8.5pt;color:var(--gold);font-weight:600;}
.label.dim{color:var(--slate);}
.sec-title{font-family:'Cinzel',serif;letter-spacing:.30em;text-transform:uppercase;
       font-size:10pt;color:var(--gold);font-weight:700;}
.body{font-family:'Montserrat',sans-serif;font-weight:300;font-size:10.5pt;
      line-height:1.85;color:var(--ivory-dim);}
.body b{color:var(--ivory);font-weight:500;}

.dia{color:var(--gold);font-size:7pt;vertical-align:middle;margin:0 .7em;}
.drule{display:flex;align-items:center;justify-content:center;margin:6mm 0;}
.drule span{height:1px;width:34mm;background:var(--hair);}
.hair{height:1px;background:var(--hair);border:0;width:100%;}

/* full-bleed image + overlays */
.bleed{position:absolute;inset:0;background-size:cover;background-position:center;}
.bleed.placeholder{background:var(--navy-deep);display:flex;align-items:center;justify-content:center;}
.scrim-bottom{position:absolute;inset:0;background:linear-gradient(to bottom,
      rgba(9,20,32,0) 30%, rgba(9,20,32,.55) 62%, rgba(9,20,32,.96) 100%);}
.scrim-full{position:absolute;inset:0;background:linear-gradient(135deg,
      rgba(9,20,32,.78), rgba(9,20,32,.55));}
.ph-big-label{font-family:'Cinzel',serif;letter-spacing:.3em;color:rgba(201,168,76,.5);
      font-size:9pt;text-transform:uppercase;text-align:center;
      border:1px dashed rgba(201,168,76,.4);padding:10mm 14mm;border-radius:2px;}
.ph-corner{position:absolute;top:11mm;left:18mm;z-index:3;font-family:'Cinzel',serif;
      font-size:6.5pt;letter-spacing:.22em;text-transform:uppercase;color:rgba(201,168,76,.45);}

/* content image blocks */
.imgwrap{background-size:cover;background-position:center;border-radius:2px;width:100%;height:46mm;}
.imgwrap.placeholder{background:var(--navy-deep);border:1px dashed rgba(201,168,76,.35);
      display:flex;align-items:center;justify-content:center;}
.ph-label{font-family:'Cinzel',serif;letter-spacing:.22em;color:rgba(201,168,76,.55);
      font-size:7.5pt;text-transform:uppercase;text-align:center;padding:4mm;}
.imgrow{display:grid;grid-template-columns:1fr 1fr;gap:5mm;}

/* footer line on inner pages */
.pfoot{position:absolute;left:18mm;right:18mm;bottom:12mm;display:flex;
      justify-content:space-between;align-items:center;
      font-family:'Cinzel',serif;letter-spacing:.22em;font-size:7pt;color:var(--slate);
      text-transform:uppercase;border-top:1px solid var(--hair);padding-top:4mm;}

/* lists */
.hl{display:grid;grid-template-columns:1fr 1fr;gap:1.6mm 9mm;margin-top:5mm;}
.hl li{list-style:none;font-weight:300;font-size:9.5pt;color:var(--ivory-dim);
      line-height:1.5;padding-left:7mm;position:relative;}
.hl li::before{content:"\\25C6";color:var(--gold);font-size:6pt;position:absolute;
      left:0;top:3.5pt;}

/* spec / accommodation tables */
.kv{display:flex;justify-content:space-between;padding:3mm 0;border-bottom:1px solid var(--hair);}
.kv .k{color:var(--slate);font-weight:300;font-size:9.5pt;}
.kv .v{color:var(--ivory);font-weight:400;font-size:9.5pt;text-align:right;}
.acc-row{padding:2.6mm 0;border-bottom:1px solid var(--hair);}
.acc-row .a-name{color:var(--ivory);font-weight:500;font-size:10pt;}
.acc-row .a-desc{color:var(--slate);font-weight:300;font-size:9.5pt;margin-top:.6mm;}
.spec-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12mm;}

/* pricing */
.price-hero{font-family:'Cormorant',serif;font-weight:500;font-size:42pt;color:var(--gold);
      letter-spacing:.01em;line-height:1;}
.cost-row{display:flex;justify-content:space-between;padding:3.2mm 0;border-bottom:1px solid var(--hair);
      font-size:10.5pt;font-weight:300;color:var(--ivory-dim);}
.cost-row .amt{color:var(--ivory);font-weight:400;}
.cost-total{display:flex;justify-content:space-between;padding:4mm 0;margin-top:1mm;
      border-top:1px solid var(--gold);font-family:'Cinzel',serif;letter-spacing:.04em;}
.cost-total .lab{font-size:10pt;color:var(--gold);text-transform:uppercase;letter-spacing:.18em;}
.cost-total .amt{font-family:'Cormorant',serif;font-weight:600;font-size:18pt;color:var(--gold);}
.pay b{color:var(--gold-soft);font-weight:600;}

/* navy harmoniser over full-bleed photos so warm/pink images stay on-brand */
.bleed-tint{position:absolute;inset:0;background:rgba(10,20,33,.50);}

/* discover-more link buttons (George-hosted URLs only) */
.linkrow{display:flex;gap:5mm;flex-wrap:wrap;margin-top:5mm;}
.btnlink{font-family:'Cinzel',serif;letter-spacing:.18em;text-transform:uppercase;
      font-size:7.5pt;color:var(--gold);text-decoration:none;
      border:1px solid var(--hair);padding:3mm 6mm;border-radius:2px;}
.linkrow.center{justify-content:center;}
/* Combined per-yacht: the discover-more link sits just under the deal panel with
   a tight margin and a slimmer button, so it always clears the absolute .pfoot
   footer (which lives at bottom:12mm) instead of colliding with it. */
.linkrow-deal .linkrow{margin-top:3mm;}
.linkrow-deal .btnlink{padding:2.2mm 5.5mm;}

/* gallery grid */
.gallery{display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin-top:8mm;}
.gallery .imgwrap{height:62mm;}
.gallery.three{grid-template-columns:1fr 1fr;}

/* metallic gold: champagne highlight -> gold -> bronze, with engraved depth.
   Applied to the large gold moments so they read as polished metal, not flat mustard. */
.gold-metal,.price-hero,.cost-total .amt{
  background:linear-gradient(180deg,#FBF0C4 0%,#E8CD86 40%,#CBA456 58%,#A07C32 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  filter:drop-shadow(0 1px 1px rgba(0,0,0,.40));
}
.sec-title{
  background:linear-gradient(180deg,#F4E3A0 0%,#D2AC54 62%,#A8842F 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}

/* ===========================================================================
   AWARD-TIER LAYER — added on top of the verbatim base. No blur (does not
   print): premium comes from large framed photos, layered translucent navy
   panels, soft gradient scrims, fine gold hairlines and editorial rhythm.
   =========================================================================== */

/* Comfortable client-reading body. */
.body{font-size:11pt;line-height:1.9;}

/* HERO PHOTO — large, near full-width, gold hairline frame. .photo holds the
   image; ::after paints a BARELY-THERE scrim so the photo reads clean (not
   darkened or split in the lower third). On the per-yacht cards we want the
   image itself, not a heavy fade — only the faintest navy whisper at the very
   bottom for frame cohesion. (The cover keeps its own stronger .scrim-bottom.) */
.photo{position:relative;width:100%;border-radius:2px;overflow:hidden;
      background-size:cover;background-position:center;
      box-shadow:0 0 0 1px var(--hair), 0 5mm 12mm rgba(0,0,0,.26);}
.photo::after{content:"";position:absolute;inset:0;pointer-events:none;
      background:linear-gradient(to bottom, rgba(9,20,32,0) 82%, rgba(9,20,32,.22) 100%);}
.photo.placeholder{background:var(--navy-deep);}
.photo.placeholder::after{background:none;}
.photo .ph-mark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      font-family:'Cinzel',serif;letter-spacing:.26em;color:rgba(201,168,76,.5);
      font-size:8pt;text-transform:uppercase;border:1px dashed rgba(201,168,76,.35);}

/* TIER EYEBROW — a small gold capsule with hairline rule, replaces the bare label. */
.tier-eyebrow{display:inline-flex;align-items:center;gap:3.5mm;}
.tier-eyebrow .t-rule{height:1px;width:9mm;background:var(--gold);opacity:.7;}
.tier-eyebrow .t-word{font-family:'Cinzel',serif;letter-spacing:.32em;text-transform:uppercase;
      font-size:7pt;color:var(--gold-soft);}

/* SPEC STRIP — small label/value fact cells, gold hairline dividers. Only ever
   shown for well-formed data (guarded in TS); never single broken glyphs. */
.spec-strip{display:flex;gap:0;margin-top:4mm;
      border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);}
.spec-strip .ss-cell{flex:1;text-align:center;padding:3mm 2mm;}
.spec-strip .ss-cell + .ss-cell{border-left:1px solid var(--hair);}
.spec-strip .ss-lab{font-family:'Cinzel',serif;letter-spacing:.24em;text-transform:uppercase;
      font-size:6pt;color:var(--gold);}
.spec-strip .ss-val{font-family:'Cormorant',serif;font-size:13pt;color:var(--ivory);margin-top:1mm;}

/* MONEY / ROUTE PANEL — the visual anchor. Layered translucent navy, gold
   hairline frame, two micro-label rows (route + dates) then right-aligned
   figures, then the gold total. Vertical rhythm is budgeted so the full panel —
   route/dates → charter fee → (discount) → extras → TOTAL → per-guest — always
   fits above the footer on one A4 page, even for a crewed yacht with the most
   rows (net-after-discount + APA + VAT + relocation). */
.deal{position:relative;margin-top:4mm;padding:4.5mm 6mm 4mm;border-radius:2px;
      background:linear-gradient(160deg, rgba(18,36,58,.92), rgba(9,20,32,.82));
      box-shadow:inset 0 0 0 1px var(--hair);}
.deal-head{display:grid;grid-template-columns:1fr 1fr;gap:2.5mm 8mm;
      padding-bottom:3mm;border-bottom:1px solid var(--hair);}
.deal-cell .d-lab{font-family:'Cinzel',serif;letter-spacing:.26em;text-transform:uppercase;
      font-size:6.5pt;color:var(--gold);}
.deal-cell .d-val{font-family:'Cormorant',serif;font-size:12.5pt;color:var(--ivory);
      margin-top:1mm;line-height:1.15;}
.deal-rows{margin-top:2.6mm;}
.deal-row{display:flex;justify-content:space-between;align-items:baseline;
      padding:1.6mm 0;border-bottom:1px solid rgba(201,168,76,.14);font-weight:300;
      font-size:10.5pt;color:var(--ivory-dim);}
.deal-row .d-amt{font-family:'Montserrat',sans-serif;font-weight:400;color:var(--ivory);
      font-variant-numeric:tabular-nums;}
/* The discount note is a sub-line of the charter fee, not a full ledger row:
   render it tight (no full vertical padding) so it never costs an extra ~6mm. */
.deal-row.muted{color:var(--slate);font-size:9.5pt;padding:1mm 0 1.4mm;border-bottom:none;}
.deal-total{display:flex;justify-content:space-between;align-items:baseline;
      margin-top:2.2mm;padding-top:2.6mm;border-top:1px solid var(--gold);}
.deal-total .dt-lab{font-family:'Cinzel',serif;letter-spacing:.2em;text-transform:uppercase;
      font-size:9pt;color:var(--gold);}
.deal-total .dt-amt{font-family:'Cormorant',serif;font-weight:600;font-size:20pt;
      font-variant-numeric:tabular-nums;line-height:1;}
.deal-foot{margin-top:2.2mm;font-size:8.5pt;color:var(--gold-soft);letter-spacing:.03em;
      font-weight:400;}
/* DIGITAL BROCHURE — understated gold micro-label on its own line at the bottom
   of the pricing/deal panel, right-aligned, within the panel's inner padding so
   there is clear space below it before the panel border (and ample gap to the
   .pfoot footer). Thin and quiet — never a button. */
.deal-brochure{display:block;text-align:right;margin-top:3mm;
      font-family:'Cinzel',serif;letter-spacing:.2em;text-transform:uppercase;
      font-size:7.5pt;color:var(--gold);text-decoration:none;font-weight:400;}
.deal-brochure .db-arrow{font-size:8pt;}

/* INSIDE-INFO — translucent panel, gold rule, italic Cormorant voice. Capped to
   ~3 lines (char cap + sentence trim in TS) and tightened so it can never push
   the pricing panel off-page. */
.inside{position:relative;margin-top:4mm;padding:4mm 6mm 4mm 6.5mm;border-radius:2px;
      background:linear-gradient(160deg, rgba(18,36,58,.7), rgba(9,20,32,.55));
      box-shadow:inset 2px 0 0 0 var(--gold), inset 0 0 0 1px var(--hair);}
.inside .i-lab{font-family:'Cinzel',serif;letter-spacing:.28em;text-transform:uppercase;
      font-size:7pt;color:var(--gold-soft);}
.inside .i-body{font-family:'Cormorant',serif;font-style:italic;font-size:12.5pt;
      line-height:1.45;color:var(--ivory);margin-top:1.8mm;}
`
  );
}

// PER-YACHT EXTRAS (bareboat) CSS — appended to the document <style> ONLY when
// the proposal actually carries per-yacht extras, so a proposal without them
// (every weekly, and every stored proposal) renders byte-for-byte as before.
// Compact block inside the money box, under the pricing rows and BEFORE
// per-guest. Tight font + line-height so a yacht with several items still
// clears the .pfoot footer on one A4 page; the on-board line wraps within the
// panel padding.
const EXTRAS_CSS = `
.deal-extras{margin-top:2.4mm;padding-top:2.2mm;border-top:1px solid rgba(201,168,76,.14);}
.deal-extras .ex-lab{font-family:'Cinzel',serif;letter-spacing:.22em;text-transform:uppercase;
      font-size:6pt;color:var(--gold);margin-top:1.6mm;}
.deal-extras .ex-lab:first-child{margin-top:0;}
.deal-extras .ex-row{display:flex;justify-content:space-between;align-items:baseline;gap:4mm;
      font-size:8.5pt;font-weight:300;color:var(--ivory-dim);line-height:1.3;margin-top:.8mm;}
.deal-extras .ex-row .ex-amt{font-family:'Montserrat',sans-serif;font-weight:400;color:var(--ivory);
      white-space:nowrap;font-variant-numeric:tabular-nums;}
.deal-extras .ex-line{font-size:8.5pt;font-weight:300;color:var(--ivory-dim);line-height:1.35;margin-top:.8mm;}`;

// PERIODS ("THE DOUBLE") CSS — appended to the document <style> ONLY when at
// least one yacht carries period_options, so a proposal without them renders
// byte-for-byte as before. Compact table inside the money box: one row per
// duration (label + muted dates left, gold fee right), an optional muted note
// sub-line, then one shared APA/VAT/gratuity foot line. Tight enough that a
// 2–3 option yacht still clears the .pfoot footer on one A4 page.
const PERIODS_CSS = `
.periods{margin-top:2.6mm;}
.periods .po-lab-head{font-family:'Cinzel',serif;letter-spacing:.22em;text-transform:uppercase;
      font-size:6.5pt;color:var(--gold);}
.periods .po-table{margin-top:1.8mm;}
.periods .po-row{display:flex;justify-content:space-between;align-items:baseline;gap:6mm;
      padding:1.8mm 0;border-bottom:1px solid rgba(201,168,76,.14);}
.periods .po-left{display:flex;flex-direction:column;}
.periods .po-left .po-lab{font-family:'Cormorant',serif;font-size:12.5pt;color:var(--ivory);
      line-height:1.1;}
.periods .po-left .po-dates{font-size:8pt;font-weight:300;color:var(--ivory-dim);
      letter-spacing:.02em;margin-top:.6mm;}
.periods .po-row .po-fee{font-family:'Cormorant',serif;font-weight:600;font-size:16pt;
      color:var(--gold);white-space:nowrap;font-variant-numeric:tabular-nums;line-height:1;}
.periods .po-note{font-size:8pt;font-weight:300;color:var(--gold-soft);
      letter-spacing:.02em;padding:0 0 1.4mm;margin-top:-.4mm;}
.periods .po-foot{margin-top:2.2mm;font-size:8pt;font-weight:300;color:var(--ivory-dim);
      line-height:1.4;letter-spacing:.01em;}

/* PER-PERIOD BREAKDOWN as a COMPARISON TABLE — one COLUMN per period (header =
   label + muted dates), row labels (Charter fee / APA / VAT / ESTIMATED ALL-IN)
   on the left, figures right-aligned per column, the ALL-IN row in gold. Tight
   type + line-height so 2–3 columns still clear the .pfoot footer on one A4 page.
   Uses a CSS grid: first column = row labels, then one fr per period. */
.periods .po-cmp{margin-top:1.8mm;display:grid;gap:0;}
.periods .po-cmp .pc-cell{padding:1.5mm 0;border-bottom:1px solid rgba(201,168,76,.12);
      font-size:9.5pt;font-weight:300;color:var(--ivory-dim);text-align:right;
      font-variant-numeric:tabular-nums;line-height:1.15;}
.periods .po-cmp .pc-rowlab{text-align:left;color:var(--slate);font-weight:300;
      padding-right:5mm;}
/* Column headers (period label + dates), gold, right-aligned over the figures. */
.periods .po-cmp .pc-head{padding:0 0 2mm;border-bottom:1px solid var(--hair);text-align:right;}
.periods .po-cmp .pc-head.pc-rowlab{border-bottom:1px solid var(--hair);}
.periods .po-cmp .pc-h-lab{font-family:'Cormorant',serif;font-size:13pt;color:var(--ivory);
      line-height:1.05;}
.periods .po-cmp .pc-h-dates{display:block;font-family:'Montserrat',sans-serif;font-size:7.5pt;
      font-weight:300;color:var(--ivory-dim);letter-spacing:.02em;margin-top:.5mm;}
.periods .po-cmp .pc-h-note{display:block;font-family:'Montserrat',sans-serif;font-size:7pt;
      font-weight:300;color:var(--gold-soft);letter-spacing:.01em;margin-top:.4mm;line-height:1.25;}
/* ALL-IN row: gold figures, gold top rule, prominent. */
.periods .po-cmp .pc-allin{border-bottom:none;border-top:1px solid var(--gold);
      padding:2.2mm 0 0;}
.periods .po-cmp .pc-allin.pc-rowlab{font-family:'Cinzel',serif;letter-spacing:.16em;
      text-transform:uppercase;font-size:8pt;color:var(--gold);}
.periods .po-cmp .pc-allin .pc-allin-amt{font-family:'Cormorant',serif;font-weight:600;
      font-size:16pt;color:var(--gold);line-height:1;white-space:nowrap;}
.periods .po-grat{margin-top:2.4mm;font-size:8pt;font-weight:300;color:var(--ivory-dim);
      line-height:1.4;letter-spacing:.01em;}`;

function wrapPages(pages: string[], title = "", extraCss = ""): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${e(title)}</title>\n` +
    `<style>${baseCss()}${extraCss}</style></head><body>${pages.join("")}</body></html>`
  );
}

// ----------------------------------------------------------------- charter type
// Normalise charter_type to one of the four valid values; anything missing or
// unrecognised collapses to "weekly" so old/blank proposals render unchanged.
function charterType(d: { charter_type?: string | null }): CharterType {
  const v = (d.charter_type ?? "").toString().trim().toLowerCase();
  return v === "bareboat" || v === "daily" || v === "custom" ? (v as CharterType) : "weekly";
}

// ----------------------------------------------------------------- owner terms
// Normalise an array-of-lines field: drop empty/whitespace entries, trim each.
function termsLines(arr?: string[] | null): string[] {
  return (Array.isArray(arr) ? arr : [])
    .map((s) => (s ?? "").toString().trim())
    .filter(Boolean);
}
function termsStr(s?: string | null): string {
  return (s ?? "").toString().trim();
}

// True when the owner supplied ANY terms content. When false, the last page
// falls back to the existing per-charter_type default text (byte-identical).
function termsHasContent(t?: Terms | null): boolean {
  if (!t) return false;
  return (
    termsLines(t.included).length > 0 ||
    termsLines(t.not_included).length > 0 ||
    termsLines(t.obligatory_extras).length > 0 ||
    termsLines(t.free_onboard).length > 0 ||
    !!termsStr(t.security_deposit) ||
    !!termsStr(t.payment) ||
    !!termsStr(t.skipper) ||
    !!termsStr(t.cancellation) ||
    !!termsStr(t.notes)
  );
}

// One labelled cell for the owner-driven last page. Two-column label/body styling
// reuses the existing .label + .body classes on that page. `bullets` => one
// gold-diamond bullet per line; `body` => a single escaped paragraph. Renders
// nothing when there is no content (so absent sections are omitted).
function termsCellBullets(label: string, lines: string[]): string {
  if (!lines.length) return "";
  const items = lines.map((l) => `<li>${e(l)}</li>`).join("");
  return `<div><div class="label">${label}</div>
    <ul class="hl" style="grid-template-columns:1fr;gap:1.2mm 0;margin-top:2.5mm;">${items}</ul></div>`;
}
function termsCellBody(label: string, body: string, gold = false): string {
  const b = termsStr(body);
  if (!b) return "";
  const color = gold ? "color:var(--gold-soft);" : "";
  return `<div><div class="label">${label}</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;${color}">${e(b)}</p></div>`;
}

// The owner-driven last-page cells, in a fixed order. Only present sections show.
// Shared by single + combined (they wrap it in their own page chrome). The
// crew/extras verbatim note is appended (when set) as its own cell.
function ownerTermsCells(t: Terms, crewNote?: string | null): string {
  return [
    termsCellBullets("What is Included", termsLines(t.included)),
    termsCellBullets("Not Included", termsLines(t.not_included)),
    termsCellBullets("Payable at Base &middot; Obligatory Extras", termsLines(t.obligatory_extras)),
    termsCellBullets("Complimentary On Board", termsLines(t.free_onboard)),
    termsCellBody("Security Deposit", t.security_deposit ?? ""),
    termsCellBody("Payment", t.payment ?? ""),
    termsCellBody("Skipper &amp; Licence", t.skipper ?? ""),
    termsCellBody("Cancellation", t.cancellation ?? ""),
    termsCellBody("Notes", t.notes ?? ""),
    termsCellBody("Crew &amp; Extras", termsStr(crewNote), true),
  ].filter(Boolean).join("\n    ");
}

// A crew/extras note rendered VERBATIM (escaped) as a quiet gold-soft line. Used
// inside the money box (and key-info) for ALL types. Empty/whitespace → "" so
// the weekly path is untouched when no note is set.
function crewNoteLine(note?: string | null): string {
  const t = (note ?? "").toString().trim();
  if (!t) return "";
  return `<div class="deal-foot" style="color:var(--gold-soft);">${e(t)}</div>`;
}

// SINGLE — compact "what's extra" note that sits under the Charter fee in the
// money box, per non-weekly type. Bareboat fee already includes VAT, so we label
// the figure "Charter fee" (never "all-in") and note the locally-paid extras.
function singleExtraNote(ctype: CharterType): string {
  if (ctype === "bareboat") {
    return `<div class="body" style="margin-top:5mm;font-size:9.5pt;">Fuel is extra and settled on return. A refundable
      security deposit applies, returned after disembarkation less any damage. Obligatory extras (e.g. end cleaning /
      transit log) are paid locally as advised for this vessel.</div>`;
  }
  if (ctype === "daily") {
    return `<div class="body" style="margin-top:5mm;font-size:9.5pt;">The day rate covers the cruising hours for the day.
      Optional extras (water sports and similar) are available on request.</div>`;
  }
  // custom
  return `<div class="body" style="margin-top:5mm;font-size:9.5pt;">Charter fee for the agreed charter period.
      Inclusions and any extras are as detailed per the operator.</div>`;
}

// SINGLE — owner-driven "Key Information" block. When the owner supplied any
// `terms` content this DRIVES the section (only present sub-sections render); the
// two-column label/body styling matches the rest of the page. Otherwise it falls
// back to the existing per-charter_type default text (byte-identical for weekly +
// every stored proposal). Used on the Charter Terms page.
function singleKeyInfoTerms(t: Terms, crewNote?: string | null): string {
  const cells = ownerTermsCells(t, crewNote);
  if (!cells) return "";
  return `
        <div style="margin-top:8mm;"><div class="label">Key Information</div>
        <div style="margin-top:4mm;display:grid;grid-template-columns:1fr 1fr;gap:6mm 8mm;">
          ${cells}
        </div></div>`;
}

// SINGLE — the type-appropriate "Key Information" block that REPLACES the weekly
// APA explainer on the Charter Terms page. NO APA / MYBA / crew-gratuity wording.
// Flexible: where the broker supplied a crew/extras note it is reflected verbatim.
function singleKeyInfo(ctype: CharterType, crewNote?: string | null): string {
  const note = (crewNote ?? "").toString().trim();
  const noteLine = note
    ? `<p class="body" style="margin-top:2.5mm;font-size:9.5pt;color:var(--gold-soft);">${e(note)}</p>`
    : "";
  if (ctype === "bareboat") {
    return `
        <div style="margin-top:8mm;"><div class="label">Key Information</div>
        <p class="body" style="margin-top:3mm;font-size:9.5pt;"><b>Included:</b> use of the yacht and her equipment,
        marine insurance, and applicable taxes &amp; VAT.</p>
        <p class="body" style="margin-top:2.5mm;font-size:9.5pt;"><b>Not included:</b> fuel, water, food &amp; drinks,
        port fees and personal expenses, which are all extra.</p>
        <p class="body" style="margin-top:2.5mm;font-size:9.5pt;"><b>Obligatory extras</b> (e.g. end cleaning / transit
        log, damage waiver) are paid locally per the operator.</p>
        <p class="body" style="margin-top:2.5mm;font-size:9.5pt;"><b>Security deposit:</b> a refundable deposit is held
        and returned after disembarkation, less any damage.</p>
        <p class="body" style="margin-top:2.5mm;font-size:9.5pt;"><b>Skipper &amp; licence:</b> a valid skipper&#8217;s
        licence is required for bareboat; a professional skipper can be arranged on request.</p>
        <p class="body" style="margin-top:2.5mm;font-size:9.5pt;"><b>Payment:</b> to be confirmed per yacht.</p>${noteLine}</div>`;
  }
  if (ctype === "daily") {
    return `
        <div style="margin-top:8mm;"><div class="label">Key Information</div>
        <p class="body" style="margin-top:3mm;font-size:9.5pt;"><b>Included:</b> the cruising hours and route for the day,
        with inclusions as detailed per the operator.</p>
        <p class="body" style="margin-top:2.5mm;font-size:9.5pt;"><b>Optional extras</b> such as water sports are available
        on request.</p>
        <p class="body" style="margin-top:2.5mm;font-size:9.5pt;"><b>Payment:</b> to be confirmed.</p>${noteLine}</div>`;
  }
  // custom — neutral, flexible wording
  return `
        <div style="margin-top:8mm;"><div class="label">Key Information</div>
        <p class="body" style="margin-top:3mm;font-size:9.5pt;">Charter fee is for the agreed charter period. Inclusions
        and any extras are as detailed per the operator.</p>
        <p class="body" style="margin-top:2.5mm;font-size:9.5pt;"><b>Payment:</b> to be confirmed.</p>${noteLine}</div>`;
}

// True when "fuel" appears in the owner's not_included list (so the money box may
// show a "Fuel — Extra" note). Matches a whole word, case-insensitive.
function notIncludedHasFuel(t?: Terms | null): boolean {
  return termsLines(t?.not_included).some((l) => /\bfuel\b/i.test(l));
}

// COMBINED — compact muted "extras" rows in a yacht's deal panel.
//
// OPT-IN (section 2): when the owner supplied `terms`, the money-box notes render
// ONLY for the values the owner actually provided — a Security deposit line only
// if terms.security_deposit is set, a "Payable at base" line only if
// terms.obligatory_extras is non-empty, a Fuel note only if "fuel" appears in
// terms.not_included. No supplied value → no note.
//
// Otherwise (no owner terms) the existing per-charter_type auto-notes are kept,
// so behaviour is unchanged when terms are unset.
function combinedExtraRows(ctype: CharterType, t?: Terms | null): string {
  if (termsHasContent(t)) {
    const rows: string[] = [];
    if (notIncludedHasFuel(t)) {
      rows.push(`<div class="deal-row muted"><span>Fuel</span><span class="d-amt">Extra, paid on return</span></div>`);
    }
    if (termsLines(t!.obligatory_extras).length) {
      rows.push(`<div class="deal-row muted"><span>Payable at base</span><span class="d-amt">Obligatory extras</span></div>`);
    }
    if (termsStr(t!.security_deposit)) {
      rows.push(`<div class="deal-row muted"><span>Security deposit</span><span class="d-amt">Refundable</span></div>`);
    }
    return rows.join("");
  }
  if (ctype === "bareboat") {
    return (
      `<div class="deal-row muted"><span>Fuel</span><span class="d-amt">Extra, paid on return</span></div>` +
      `<div class="deal-row muted"><span>Obligatory extras</span><span class="d-amt">Paid locally</span></div>` +
      `<div class="deal-row muted"><span>Security deposit</span><span class="d-amt">Refundable</span></div>`
    );
  }
  if (ctype === "daily") {
    return `<div class="deal-row muted"><span>Day rate</span><span class="d-amt">Inclusions per operator</span></div>`;
  }
  // custom
  return `<div class="deal-row muted"><span>For the agreed period</span><span class="d-amt">Inclusions per operator</span></div>`;
}

// True when a yacht carries ANY structured per-yacht bareboat extra (so we render
// the real per-yacht block instead of the generic opt-in placeholder note).
function hasYachtExtras(y: CombinedYacht): boolean {
  const pab = Array.isArray(y.payable_at_base)
    ? y.payable_at_base.filter((p) => p && typeof p.label === "string" && p.label.trim()).length
    : 0;
  const dep = (y.security_deposit ?? "").toString().trim();
  const fob = Array.isArray(y.free_onboard)
    ? y.free_onboard.map((s) => (s ?? "").toString().trim()).filter(Boolean).length
    : 0;
  return pab > 0 || !!dep || fob > 0;
}

// COMBINED — PER-YACHT extras block, rendered COMPACTLY inside this yacht's money
// box (under the pricing rows, before per-guest). Each yacht carries its OWN
// payable-at-base / security-deposit / complimentary-on-board values. Only the
// groups with content render; an entirely empty yacht returns "" (weekly + every
// stored proposal unchanged). NO commission / price-to-agency is ever shown.
function yachtExtrasBlock(y: CombinedYacht): string {
  const pab = (Array.isArray(y.payable_at_base) ? y.payable_at_base : [])
    .filter((p) => p && typeof p.label === "string" && p.label.trim());
  const dep = (y.security_deposit ?? "").toString().trim();
  const fob = (Array.isArray(y.free_onboard) ? y.free_onboard : [])
    .map((s) => (s ?? "").toString().trim())
    .filter(Boolean);
  if (!pab.length && !dep && !fob.length) return "";

  const parts: string[] = [];
  if (pab.length) {
    parts.push(`<div class="ex-lab">Payable at Base</div>`);
    for (const p of pab) {
      const amt = (p.amount ?? "").toString().trim();
      parts.push(
        `<div class="ex-row"><span>${e(p.label.trim())}</span>` +
        (amt ? `<span class="ex-amt">${e(amt)}</span>` : "") +
        `</div>`,
      );
    }
  }
  if (dep) {
    parts.push(`<div class="ex-lab">Security Deposit</div>`);
    parts.push(`<div class="ex-line">${e(dep)}</div>`);
  }
  if (fob.length) {
    parts.push(`<div class="ex-lab">On Board</div>`);
    parts.push(`<div class="ex-line">${fob.map((s) => e(s)).join(" &middot; ")}</div>`);
  }
  return `<div class="deal-extras">${parts.join("")}</div>`;
}

// ---------------------------------------------------------- PERIODS ("THE DOUBLE")
// True when a yacht carries >=1 valid period option (a non-empty fee_disp). When
// it does, the money box renders the compact PERIODS & RATES table INSTEAD of the
// single charter-fee/all-in rows. Absent / empty => the single-pricing money box
// renders EXACTLY as before (weekly + every stored proposal unchanged).
// A cleaned period option carrying BOTH the formatted fallback (fee_disp) and the
// computable numerics (fee/apa_pct/vat_pct) so the block can pick simple vs
// breakdown rendering. fee_disp is derived from fee when only the number is set.
type CleanPeriod = {
  label: string;
  dates: string;
  fee?: number;
  fee_disp: string;
  apa_pct?: number;
  vat_pct?: number;
  note: string;
};

// Parse a numeric period field that may arrive as a number OR a string. Returns
// undefined for empty/unparseable so "not set" stays distinct from 0.
function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function validPeriodOptions(y: CombinedYacht): CleanPeriod[] {
  return (Array.isArray(y.period_options) ? y.period_options : [])
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const fee = numOrUndef(p.fee);
      const feeDispRaw = (p.fee_disp ?? "").toString().trim();
      return {
        label: (p.label ?? "").toString().trim(),
        dates: (p.dates ?? "").toString().trim(),
        fee,
        // Prefer the explicit display string; else format the numeric fee.
        fee_disp: feeDispRaw || (fee !== undefined ? fmtEur(fee) : ""),
        apa_pct: numOrUndef(p.apa_pct),
        vat_pct: numOrUndef(p.vat_pct),
        note: (p.note ?? "").toString().trim(),
      } as CleanPeriod;
    })
    // An option is renderable when it has at least a fee OR a label (so a robust
    // merge that only captured the fee, or only the label, still shows up).
    .filter((p) => p.fee_disp || p.label);
}

function hasPeriodOptions(y: CombinedYacht): boolean {
  return validPeriodOptions(y).length > 0;
}

// The broker wants a COMPUTED breakdown for this yacht when at least one period
// carries an APA % or VAT % (i.e. the broker filled the figures). Until then we
// keep the simple "label · dates · fee + generic note" display unchanged.
function wantsBreakdown(opts: CleanPeriod[]): boolean {
  // Show the full Charter / APA / VAT / all-in breakdown whenever a period is
  // priced — APA defaults to 40% and VAT to 12% (both broker-overridable), so the
  // client sees the real total on the very first Regenerate without the broker
  // having to hunt for a percentage field.
  return opts.some(
    (p) => p.apa_pct !== undefined || p.vat_pct !== undefined || (typeof p.fee === "number" && p.fee > 0),
  );
}

// COMBINED — compact PERIODS & RATES table for a yacht quoted across 2+ durations.
// One row per option: LEFT = label + (muted, smaller dates); RIGHT = fee_disp
// (gold, prominent); an optional muted sub-line for note. BELOW the table, ONE
// shared muted note line covering APA / VAT / crew gratuity (these crewed motor
// yachts are quoted "plus expenses"). Tight type so a yacht with 2–3 options
// still clears the .pfoot footer on one A4 page. NO commission ever appears.
function periodOptionsBlock(y: CombinedYacht): string {
  const opts = validPeriodOptions(y);
  if (!opts.length) return "";
  // BREAKDOWN MODE: render the full per-period breakdown as a COMPARISON TABLE.
  // The percentages the broker typed in the yacht's MAIN pricing fields (APA % /
  // VAT %) are inherited by every period, so the broker sets APA once and both
  // durations use it. A period's own apa/vat still wins; final fallback 40% / 12%.
  const yApa = typeof y.pricing?.apa_pct === "number" && y.pricing.apa_pct > 0 ? y.pricing.apa_pct : undefined;
  const yVat = typeof y.pricing?.vat_pct === "number" && y.pricing.vat_pct > 0 ? y.pricing.vat_pct : undefined;
  if (wantsBreakdown(opts)) return periodBreakdownTable(opts, yApa, yVat);

  // SIMPLE MODE (unchanged): label · dates · fee, plus one shared APA/VAT/gratuity
  // note. This is byte-identical to the previous "double" output.
  const rows = opts
    .map((p) => {
      const left =
        `<div class="po-left"><span class="po-lab">${e(p.label || "Option")}</span>` +
        (p.dates ? `<span class="po-dates">${e(p.dates)}</span>` : "") +
        `</div>`;
      const right = `<span class="po-fee">${e(p.fee_disp)}</span>`;
      const noteLine = p.note ? `<div class="po-note">${e(p.note)}</div>` : "";
      return `<div class="po-row">${left}${right}</div>${noteLine}`;
    })
    .join("");
  return (
    `<div class="periods">` +
    `<div class="po-lab-head">Periods &amp; Rates</div>` +
    `<div class="po-table">${rows}</div>` +
    `<div class="po-foot">Each rate is plus APA (estimated 35-40%), VAT 12%, and crew gratuity 10-15% as per MYBA.</div>` +
    `</div>`
  );
}

// Percent label for a column header / row label — "40%" / "6.5%". Empty when
// the percent is undefined (so "APA" / "VAT" render bare in that edge case).
function pctLabel(v?: number): string {
  if (v === undefined) return "";
  return Math.abs(v - Math.trunc(v)) < 1e-9 ? `${Math.trunc(v)}%` : `${v}%`;
}

// COMBINED — PER-PERIOD BREAKDOWN as a COMPARISON TABLE. Row labels on the left
// (Charter fee / APA (x%) / VAT (y%) / ESTIMATED ALL-IN), ONE COLUMN per period
// (header = label + muted dates [+ optional muted note], gold figures, ALL-IN row
// gold). Each column is computed by the deterministic computePricing in breakdown
// mode — NO new math here. 1 period → 1 value column; 2–3 → side-by-side; 4+ →
// still columns but tightened. Fits one A4 page (tight type; hero shrinks to 78mm
// on breakdown pages — see renderCombinedYacht). NO commission ever appears.
// Derive a "<n> nights" header label from the period's own date range, so a
// mistyped or mis-extracted count (e.g. "6 nights" against 31 Aug – 7 Sep, which
// is really 7) is corrected to the truth the dates already state. Only overrides
// when the stored label IS a bare nights-count AND both dates parse cleanly;
// otherwise the stored label is kept verbatim (e.g. "Low season", "Option").
const _MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
function nightsFromRange(dates?: string): number | null {
  const s = (dates ?? "").trim();
  if (!s) return null;
  const parts = s.split(/\s*[–—-]\s*/);
  if (parts.length !== 2) return null;
  const yearM = s.match(/\b(20\d{2})\b/);
  const fallbackYear = yearM ? parseInt(yearM[1], 10) : null;
  const parseSide = (side: string): number | null => {
    const m = side.trim().match(/(\d{1,2})\s+([A-Za-z]{3,})\.?(?:\s+(\d{4}))?/);
    if (!m) return null;
    const mon = _MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon === undefined) return null;
    const year = m[3] ? parseInt(m[3], 10) : fallbackYear;
    if (!year) return null;
    return Date.UTC(year, mon, parseInt(m[1], 10));
  };
  const a = parseSide(parts[0]);
  const b = parseSide(parts[1]);
  if (a === null || b === null) return null;
  const nights = Math.round((b - a) / 86_400_000);
  return nights >= 1 && nights <= 120 ? nights : null;
}
function nightsLabel(label?: string, dates?: string): string {
  const stored = (label ?? "").trim();
  if (/^\d+\s*nights?$/i.test(stored)) {
    const n = nightsFromRange(dates);
    if (n !== null) return `${n} night${n === 1 ? "" : "s"}`;
  }
  return stored || "Option";
}

function periodBreakdownTable(opts: CleanPeriod[], defApa?: number, defVat?: number): string {
  // The APA/VAT % row labels use the FIRST period that has each percent (the
  // broker normally sets one APA % across all periods of a yacht). VAT defaults
  // to 12% (Greece) for the label when a fee is computed but no VAT % was typed.
  // Broker-set percentages win; otherwise default APA 40% / VAT 12% so the
  // breakdown always computes a real total (the broker can override per yacht).
  const firstApa = opts.find((p) => p.apa_pct !== undefined)?.apa_pct ?? defApa ?? 40;
  const firstVat = opts.find((p) => p.vat_pct !== undefined)?.vat_pct ?? defVat ?? 12;
  const apaLabel = `APA (${pctLabel(firstApa)})`;
  const vatLabel = `VAT (${pctLabel(firstVat)})`;

  // Per-column computed pricing (deterministic). A column with no numeric fee
  // falls back to its fee_disp string for the charter-fee cell and blanks the
  // computed rows (robust: a half-filled period never crashes the table).
  const cols = opts.map((p) => {
    if (p.fee === undefined) {
      return { p, charter: p.fee_disp || "", apa: "", vat: "", allIn: "" };
    }
    const pr = computePricing({
      mode: "breakdown",
      charter_fee: p.fee,
      apa_pct: p.apa_pct ?? defApa ?? 40,
      vat_pct: p.vat_pct ?? defVat ?? 12,
    });
    // Pull the APA / VAT amounts off the computed rows (labels start "APA"/"VAT").
    const apaRow = pr.rows.find((r) => r[0].startsWith("APA"));
    const vatRow = pr.rows.find((r) => r[0].startsWith("VAT"));
    return {
      p,
      charter: pr.charter_fee_disp,
      apa: apaRow ? apaRow[1] : "",
      vat: vatRow ? vatRow[1] : "",
      allIn: pr.all_in ?? "",
    };
  });

  const n = cols.length;
  // grid: a left label column (auto) + one equal fraction per period.
  const gridCols = `minmax(28mm,auto) repeat(${n}, 1fr)`;

  // Build each grid ROW as: [row-label cell] + [one value cell per column].
  const headCells =
    `<div class="pc-cell pc-head pc-rowlab"></div>` +
    cols
      .map((c) => {
        const dates = c.p.dates ? `<span class="pc-h-dates">${e(c.p.dates)}</span>` : "";
        const note = c.p.note ? `<span class="pc-h-note">${e(c.p.note)}</span>` : "";
        return `<div class="pc-cell pc-head"><span class="pc-h-lab">${e(nightsLabel(c.p.label, c.p.dates))}</span>${dates}${note}</div>`;
      })
      .join("");

  const rowLine = (label: string, vals: string[], extraCls = "") => {
    const lab = `<div class="pc-cell pc-rowlab ${extraCls}">${label}</div>`;
    const cells = vals
      .map((v) =>
        extraCls.includes("pc-allin")
          ? `<div class="pc-cell ${extraCls}"><span class="pc-allin-amt gold-metal">${v}</span></div>`
          : `<div class="pc-cell ${extraCls}">${v}</div>`,
      )
      .join("");
    return lab + cells;
  };

  const charterRow = rowLine("Charter fee", cols.map((c) => c.charter));
  const apaRow = rowLine(apaLabel, cols.map((c) => c.apa));
  const vatRow = rowLine(vatLabel, cols.map((c) => c.vat));
  const allInRow = rowLine("Estimated All-In", cols.map((c) => c.allIn), "pc-allin");

  return (
    `<div class="periods">` +
    `<div class="po-lab-head">Periods &amp; Rates</div>` +
    `<div class="po-cmp" style="grid-template-columns:${gridCols};">` +
    headCells +
    charterRow +
    apaRow +
    vatRow +
    allInRow +
    `</div>` +
    `<div class="po-grat">Crew gratuity 10-15% as per MYBA, at the client&#8217;s discretion (not included above).</div>` +
    `</div>`
  );
}

// ----------------------------------------------------------------- SINGLE
function renderSingle(d: SingleProposal): string {
  const y = d.yacht;
  const pr = computePricing(y.pricing);
  const imgs: Images = y.images ?? {};
  const noMyba = d.no_myba ?? false;
  const ctype = charterType(d);
  const crewNoteHtml = crewNoteLine(d.crew_note);
  const pages: string[] = [];

  // Cleaned shared strings (robust dates + middot spec line + round-trip voyage).
  const specClean = cleanSpecLine(y.spec_line);
  const periodClean = cleanDateRange(y.period_line ?? "");
  const voyageClean = formatVoyage(y.voyage_line);

  // ---- P1 COVER ----
  const cover = imgs.cover;
  const bg = cover
    ? `<div class='bleed' style="background-image:url(${cover})"></div><div class='bleed-tint'></div>`
    : `<div class='bleed placeholder'></div><div class='ph-corner'>Image &#8226; full-bleed cover</div>`;
  pages.push(`
<div class="page">
  ${bg}
  <div class="scrim-bottom"></div>
  <div class="scrim-bottom" style="background:linear-gradient(to bottom,rgba(9,20,32,.42) 0%,rgba(9,20,32,0) 22%,rgba(9,20,32,0) 60%,rgba(9,20,32,.30) 100%);"></div>
  <div class="pad" style="display:flex;flex-direction:column;padding:22mm 18mm;">
    <div style="text-align:center;">
      <div class="label">Confidential Charter Proposal</div>
      <div class="drule"><span></span>${DIAMOND}<span></span></div>
    </div>
    <div style="flex:1.6;"></div>
    <div style="text-align:center;">
      <div class="label" style="color:var(--ivory-dim);">${e(y.type ?? "Motor Yacht")}</div>
      <h1 class="cinzel gold-metal" style="font-size:36pt;letter-spacing:.13em;color:var(--gold);
            margin:5mm 0 4mm;font-weight:700;">${e(y.name)}</h1>
      <div class="body" style="color:var(--ivory);letter-spacing:.10em;font-size:10pt;">${e(specClean)}</div>
      <div class="drule"><span></span>${DIAMOND}<span></span></div>
      <div class="label dim" style="letter-spacing:.18em;">${e(periodClean)}</div>
      <div class="price-hero" style="margin:7mm 0 3mm;">${pr.headline}</div>
      <div class="body" style="font-size:9pt;color:var(--slate);letter-spacing:.06em;">${e(y.price_sub ?? "")}</div>
    </div>
    <div style="flex:0.6;"></div>
    <div style="text-align:center;">
      <div class="label dim" style="font-size:6.5pt;letter-spacing:.2em;">
        Confidential &#8226; Proprietary &#8226; Prepared solely for the named recipient</div>
    </div>
  </div>
</div>`);

  // ---- P2 THE EXPERIENCE ----
  const expParas = (y.experience_paras ?? [])
    .map((t) => `<p style='margin-bottom:3.5mm;'>${e(t)}</p>`)
    .join("");
  const highlights = y.highlights ?? [];
  let hl = "";
  if (highlights.length) {
    const items = highlights.map((h) => `<li>${e(h)}</li>`).join("");
    hl = `<div style="margin-top:9mm;"><div class="label">Key Highlights</div>
                 <ul class="hl">${items}</ul></div>`;
  }
  pages.push(`
<div class="page"><div class="pad">
  ${heroPhoto(imgs.experience, "Lifestyle - deck / sunset / dining", "104mm")}
  <div style="margin-top:9mm;">
    <div class="sec-title">${e(y.experience_title ?? "The Experience")}</div>
    <hr class="hair" style="margin:5mm 0 7mm;">
    <div class="body">${expParas}</div>
  </div>
  ${hl}
  ${linkButtons(y.links)}
  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(y.name)} &#8226; 02</span></div>
</div></div>`);

  // ---- P3 INTERIOR & LIFESTYLE ----
  const acc = y.accommodation;
  const crew = y.crew_line;
  if (acc || crew) {
    let accHtml = "";
    if (acc) {
      const rows = acc
        .map(
          (a) =>
            `<div class='acc-row'><div class='a-name'>${e(a[0])}</div>` +
            `<div class='a-desc'>${e(a[1])}</div></div>`,
        )
        .join("");
      accHtml = `<div class='label'>Accommodation</div><div style='margin-top:4mm;'>${rows}</div>`;
    }
    let crewHtml = "";
    if (crew) {
      crewHtml = `<div style='margin-top:9mm;'><div class='label'>Professional Crew</div><p class='body' style='margin-top:4mm;font-size:10pt;'>${e(crew)}</p></div>`;
    }
    pages.push(`
<div class="page"><div class="pad">
  <div class="sec-title">Interior &amp; Lifestyle</div>
  <hr class="hair" style="margin:5mm 0 7mm;">
  <div class="imgrow" style="margin-bottom:9mm;">
    ${imgOrPlaceholder(imgs.interior1, "Interior - salon / master", "ph", "58mm")}
    ${imgOrPlaceholder(imgs.interior2, "Interior - dining / detail", "ph", "58mm")}
  </div>
  ${accHtml}
  ${crewHtml}
  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(y.name)} &#8226; 03</span></div>
</div></div>`);
  }

  // ---- GALLERY (optional) ----
  const gp = galleryPage(y, d.white_label);
  if (gp) pages.push(gp);

  // ---- P4 EXTERIOR & WATER TOYS ----
  const toys = y.water_toys;
  const specs = y.tech_specs;
  if (toys || specs) {
    let toysHtml = "";
    if (toys) {
      const items = toys.map((t) => `<li>${e(t)}</li>`).join("");
      toysHtml = `<div class='label'>Water Toys &amp; Tenders</div><ul class='hl'>${items}</ul>`;
    }
    let specsHtml = "";
    if (specs) {
      const half = Math.floor((specs.length + 1) / 2);
      const col1 = specs
        .slice(0, half)
        .map((s) => `<div class='kv'><span class='k'>${e(s[0])}</span><span class='v'>${e(s[1])}</span></div>`)
        .join("");
      const col2 = specs
        .slice(half)
        .map((s) => `<div class='kv'><span class='k'>${e(s[0])}</span><span class='v'>${e(s[1])}</span></div>`)
        .join("");
      specsHtml = `<div style='margin-top:10mm;'><div class='label'>Technical Specifications</div><div class='spec-grid' style='margin-top:4mm;'><div>${col1}</div><div>${col2}</div></div></div>`;
    }
    pages.push(`
<div class="page"><div class="pad">
  <div class="sec-title">Exterior &amp; Water Toys</div>
  <hr class="hair" style="margin:5mm 0 7mm;">
  ${heroPhoto(imgs.exterior, "Exterior - aerial / cruising", "98mm")}
  <div style="margin-top:9mm;">${toysHtml}</div>
  ${specsHtml}
  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(y.name)} &#8226; 04</span></div>
</div></div>`);
  }

  // ---- P5 CHARTER TERMS & PRICING ----
  const details = y.pricing?.details ?? [];
  const detHtml = details
    .map((x) => `<div class='kv'><span class='k'>${e(x[0])}</span><span class='v'>${e(x[1])}</span></div>`)
    .join("");

  // OWNER-SELECTABLE last page (section 1): when the owner supplied any `terms`
  // content the Key-Information block is driven by it (only present sections), and
  // the generic per-type "extras" prose under the charter fee is suppressed (the
  // owner's explicit terms supersede it). When terms are unset everything below is
  // byte-identical to before.
  const hasTerms = termsHasContent(d.terms);
  let costBlock = "";
  let apaNote = "";
  let payBlock = "";
  if (pr.day_charter) {
    // ---- DAY CHARTER single-yacht cost block: two FINAL all-in rates
    // (half day / full day), each as shown. No APA / VAT / MYBA schedule.
    costBlock =
      pr.rows
        .map(([l, a]) => `<div class='cost-row'><span>${e(l)}</span><span class='amt'>${a}</span></div>`)
        .join("") +
      `<div class="body" style="margin-top:5mm;font-size:9.5pt;">Day-charter rates as shown, all-inclusive of the operator's standard services for the duration.</div>`;
    apaNote = "";
    payBlock = "";
  } else if (ctype !== "weekly") {
    // ---- BAREBOAT / DAILY / CUSTOM single-yacht cost block. Charter fee is the
    // headline figure (NOT "all-in"); NO APA / VAT-extra rows; NO MYBA 50-50.
    // The Key-Info on this page becomes the type-appropriate inclusions text.
    const fee = pr.charter_fee_disp || pr.headline;
    costBlock =
      `<div class='cost-row'><span>Charter fee</span><span class='amt'>${fee}</span></div>` +
      (pr.discount_note ? `<div class="body" style="font-size:9.5pt;font-weight:600;color:var(--gold-soft);margin:2mm 0;">${e(pr.discount_note)}</div>` : "") +
      (hasTerms ? "" : singleExtraNote(ctype));
    apaNote = singleKeyInfo(ctype, d.crew_note);
    payBlock = "";
  } else if (pr.all_inclusive) {
    costBlock = `<div class="cost-row"><span>All-inclusive</span><span class="amt">${pr.all_in}</span></div>
        <div class="body" style="margin-top:5mm;font-size:9.5pt;">Everything is included (APA, VAT, and all extras).</div>`;
    payBlock = noMyba ? "" : `
        <div style="margin-top:8mm;"><div class="label">Payment Schedule (MYBA)</div>
        <div class="body pay" style="margin-top:3mm;font-size:9.5pt;line-height:1.7;">
          <b>Upon signing of the Charter Agreement</b> - 50%: ${pr.deposit}<br>
          <b>Four weeks prior to embarkation</b> - balance: ${pr.balance}<br>
          All charges (APA, VAT and extras) are included in the all-inclusive price.
        </div></div>`;
  } else if (pr.extras_mode) {
    costBlock = `
        <div class="cost-row"><span>Charter Fee</span><span class="amt">${pr.charter_fee_disp}</span></div>
        <div class="body" style="margin-top:5mm;font-size:9.5pt;">All operating expenses (fuel, food &amp; beverages,
            port fees and provisioning) are additional and settled directly, as advised for this vessel.</div>`;
  } else {
    const crows = pr.rows
      .map(([l, a]) => `<div class='cost-row'><span>${e(l)}</span><span class='amt'>${a}</span></div>`)
      .join("");
    const total = pr.all_in
      ? `<div class='cost-total'><span class='lab'>Estimated All-In Total</span><span class='amt'>${pr.all_in}</span></div>`
      : "";
    costBlock =
      `<div class='cost-row'><span>Charter Fee</span><span class='amt'>${pr.charter_fee_disp}</span></div>` +
      (pr.discount_note ? `<div class="body" style="font-size:9.5pt;font-weight:600;color:var(--gold-soft);margin:2mm 0;">${e(pr.discount_note)}</div>` : "") +
      crows +
      total;
    apaNote = `
        <div style="margin-top:8mm;"><div class="label">About the APA</div>
        <p class="body" style="margin-top:3mm;font-size:9.5pt;">The Advance Provisioning Allowance covers fuel,
        food &amp; beverages, port fees, communications and miscellaneous costs. It is managed transparently by
        the Captain, and any unused portion is refunded in full after disembarkation with a detailed expense log.</p></div>`;
    if (noMyba) {
      payBlock = "";
    } else {
      payBlock = `
        <div style="margin-top:8mm;"><div class="label">Payment Schedule (MYBA)</div>
        <div class="body pay" style="margin-top:3mm;font-size:9.5pt;line-height:1.7;">
          <b>Upon signing of the Charter Agreement</b> - 50% of the net charter fee: ${pr.deposit}<br>
          <b>Four weeks prior to embarkation</b> - remaining 50% of the charter fee + full APA + full VAT: ${pr.balance}<br>
          <b>Post-charter</b> - unused APA refunded within four weeks with a full expense log.
        </div></div>`;
    }
  }

  // OWNER-DRIVEN Key Information (section 1): when present, it replaces whatever
  // default Key-Info / APA explainer the branches above produced. For weekly this
  // also suppresses the MYBA payment schedule (the owner's `terms.payment` is the
  // source of truth). Absent terms => unchanged.
  if (hasTerms) {
    apaNote = singleKeyInfoTerms(d.terms!, d.crew_note);
    payBlock = "";
  }

  // Per-guest estimate at 4 and 6 guests (when an all-in total exists).
  const perPerson = (SHOW_PER_GUEST && pr.per_person_4)
    ? `<div style="margin-top:8mm;"><div class="label">Per Guest (estimate)</div>
        <div class="body" style="margin-top:3mm;font-size:9.5pt;line-height:1.7;">
          Based on 4 guests: <b>${pr.per_person_4}</b><br>
          Based on 6 guests: <b>${pr.per_person_6}</b>
        </div></div>`
    : "";

  const detSection = detHtml
    ? `<div style='margin-top:8mm;'><div class='label'>Charter Details</div><div style='margin-top:4mm;'>${detHtml}</div></div>`
    : "";

  pages.push(`
<div class="page"><div class="pad">
  <div class="sec-title">Charter Terms &amp; Pricing</div>
  <hr class="hair" style="margin:5mm 0 8mm;">
  <div style="text-align:center;margin-bottom:6mm;">
    <div class="price-hero">${pr.headline}</div>
    <div class="label dim" style="margin-top:3mm;letter-spacing:.16em;">${e(periodClean)}</div>${voyageClean ? `\n    <div class="label dim" style="margin-top:2mm;letter-spacing:.12em;font-size:7pt;color:var(--gold-soft);">${e(voyageClean)}</div>` : ""}
  </div>
  ${detSection}
  <div style="margin-top:8mm;">${costBlock}</div>
  ${apaNote}
  ${payBlock}
  ${perPerson}
  ${(crewNoteHtml && !hasTerms) ? `<div style="margin-top:6mm;">${crewNoteHtml}</div>` : ""}
  ${brochureLink(y.links)}
  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(y.name)} &#8226; 05</span></div>
</div></div>`);

  // ---- P6 CLOSING ----
  const close = imgs.closing;
  const cbg = close
    ? `<div class='bleed' style="background-image:url(${close})"></div><div class='bleed-tint'></div>`
    : `<div class='bleed placeholder'></div><div class='ph-corner'>Image &#8226; full-bleed closing</div>`;
  pages.push(`
<div class="page">
  ${cbg}<div class="scrim-full"></div>
  <div class="pad" style="display:flex;flex-direction:column;justify-content:center;text-align:center;">
    <div class="label" style="color:var(--gold);">${e(y.type ?? "")} &#8226; ${e(y.name)}</div>
    <div class="drule"><span></span>${DIAMOND}<span></span></div>
    <h2 class="corm" style="font-size:30pt;font-weight:500;color:var(--ivory);margin:2mm 0 5mm;">
      Your Mediterranean Journey Awaits</h2>
    <div class="body" style="font-size:9.5pt;color:var(--ivory-dim);">${e(specClean)}</div>
    ${footerBlock(d)}
  </div>
</div>`);

  return wrapPages(pages, y.name);
}

// ----------------------------------------------------------------- COMBINED
// ============================================================= HELM v2 blocks
// (George's PDF critique, 2026-07-15). All ADDITIVE: they render only from
// data that exists (or new optional fields), so nothing here disturbs the
// single-mode render or any non-combined flow.

const HELM_V2_CSS = `
/* SELECTION AT A GLANCE — one-page comparison table */
.cmp{width:100%;border-collapse:collapse;margin-top:6mm;}
.cmp th{font-family:'Cinzel',serif;letter-spacing:.22em;text-transform:uppercase;font-size:6.8pt;
      color:var(--gold-soft);text-align:left;padding:2.2mm 2.5mm;border-bottom:1px solid var(--hair);}
.cmp td{font-family:'Montserrat',sans-serif;font-size:8.6pt;color:var(--ivory);
      padding:2.6mm 2.5mm;border-bottom:1px solid rgba(201,168,76,.10);vertical-align:top;line-height:1.35;}
.cmp td.c-name{font-family:'Cinzel',serif;letter-spacing:.06em;font-size:9.2pt;color:var(--gold);white-space:nowrap;}
.cmp td.c-amt{text-align:right;font-family:'Cormorant',serif;font-size:11.5pt;white-space:nowrap;}
.cmp tr.c-reco td{background:linear-gradient(90deg,rgba(201,168,76,.10),rgba(201,168,76,.03));}
.cmp .c-tier{font-family:'Cinzel',serif;letter-spacing:.16em;text-transform:uppercase;font-size:6.4pt;color:var(--gold-soft);}
.cmp-note{font-family:'Cormorant',serif;font-style:italic;font-size:11.5pt;color:var(--ivory);
      margin-top:6mm;line-height:1.5;}
.cmp-fine{font-family:'Montserrat',sans-serif;font-size:7pt;color:var(--ivory-dim);margin-top:3mm;line-height:1.5;}

/* PHOTO STRIP — three small framed photos under the hero */
.pstrip{display:grid;grid-template-columns:1fr 1fr 1fr;gap:2.5mm;margin-top:2.5mm;}
.pstrip .ps{height:24mm;background-size:cover;background-position:center;border-radius:1px;
      box-shadow:inset 0 0 0 1px rgba(201,168,76,.28), inset 0 -8mm 10mm -6mm rgba(9,20,32,.55);}

/* deal date-note — muted italic clarification under the route/dates header */
.deal-datenote{font-family:'Cormorant',serif;font-style:italic;font-size:9.5pt;color:var(--ivory-dim);
      margin:1.6mm 0 0;line-height:1.35;}

/* A WEEK LIKE THIS — sample itinerary table */
.wk{width:100%;border-collapse:collapse;margin-top:5mm;}
.wk td{font-family:'Montserrat',sans-serif;font-size:8.8pt;color:var(--ivory);padding:2.4mm 2.5mm;
      border-bottom:1px solid rgba(201,168,76,.10);vertical-align:top;line-height:1.45;}
.wk td.w-day{font-family:'Cinzel',serif;letter-spacing:.14em;font-size:7.4pt;color:var(--gold-soft);white-space:nowrap;padding-top:2.9mm;}
.wk td.w-leg{font-family:'Cormorant',serif;font-size:11.5pt;color:var(--gold);white-space:nowrap;}

/* PHOTO FIT — portrait photo shown WHOLE over a blurred self-backdrop.
   The blur fills the wide frame; the photo itself is never cropped. */
.photo-fit{position:relative;overflow:hidden;}
.photo-fit .pf-bg{position:absolute;inset:0;background-size:cover;background-position:center;
      filter:blur(16px) brightness(.5) saturate(.85);transform:scale(1.18);}
.photo-fit .pf-img{position:absolute;inset:0;background-size:contain;background-position:center;
      background-repeat:no-repeat;}

/* CREW LINE — one quiet sentence + the owner-confirmation footnote */
.crewline{margin-top:2.6mm;padding-left:6.5mm;}
.crewline .c-lab{display:inline;font-family:'Cinzel',serif;letter-spacing:.24em;text-transform:uppercase;
      font-size:6.6pt;color:var(--gold-soft);margin-right:2mm;}
.crewline .c-txt{display:inline;font-family:'Montserrat',sans-serif;font-size:8.4pt;color:var(--ivory);line-height:1.45;}
.crewline .c-note{font-family:'Montserrat',sans-serif;font-size:6.4pt;color:var(--ivory-dim);margin-top:.8mm;line-height:1.4;}

/* WHAT HAPPENS NEXT — full-width band on the key information page */
.next-band{margin-top:8mm;padding:5mm 6mm;border-radius:2px;
      background:linear-gradient(160deg, rgba(18,36,58,.7), rgba(9,20,32,.55));
      box-shadow:inset 2px 0 0 0 var(--gold), inset 0 0 0 1px var(--hair);}
.next-band .n-lab{font-family:'Cinzel',serif;letter-spacing:.28em;text-transform:uppercase;font-size:7pt;color:var(--gold-soft);}
.next-band .n-steps{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6mm;margin-top:3mm;}
.next-band .n-step{font-family:'Montserrat',sans-serif;font-size:8.6pt;color:var(--ivory);line-height:1.5;}
.next-band .n-num{font-family:'Cormorant',serif;font-size:14pt;color:var(--gold);line-height:1;margin-bottom:1mm;}
`;

// One-page "Selection at a Glance": the decision surface. Rendered only for
// 3+ yachts. The recommended row (tier matching /recommendation/i) is washed
// in gold; the note under the table is the explicit next step.
function comparisonPage(d: CombinedProposal): string {
  const yachts = d.yachts ?? [];
  if (yachts.length < 3) return "";
  const rows = yachts
    .map((y, i) => {
      const pr = computePricing(y.pricing);
      const voyage = formatVoyage(y.voyage_line);
      let dates = voyage;
      const vdot = voyage.indexOf(" \u00b7 ");
      if (vdot !== -1) dates = voyage.slice(vdot + 3).trim();
      const amount = Array.isArray(y.period_options) && y.period_options.length
        ? "See periods & rates"
        : (pr.all_in || pr.headline || pr.charter_fee_disp || "");
      const isReco = /recommendation/i.test(y.tier_label ?? "");
      return `<tr${isReco ? ' class="c-reco"' : ""}>
        <td class="c-name">${String(i + 1).padStart(2, "0")} &nbsp;${e(y.name)}</td>
        <td><div>${e(y.type ?? "")}</div>${y.tier_label ? `<div class="c-tier">${e(y.tier_label)}</div>` : ""}</td>
        <td>${e(dates)}</td>
        <td class="c-amt">${amount}</td>
      </tr>`;
    })
    .join("");
  // Mention a discount in the fine print ONLY when at least one yacht actually
  // carries one - the phrase "after any offered discount" on a no-discount
  // proposal plants an expectation (George, 2026-07-15).
  const anyDiscount = yachts.some((y) => {
    const pr = computePricing(y.pricing);
    return !!(pr.discount_note || pr.net_after_discount);
  });
  const reco = yachts.find((y) => /recommendation/i.test(y.tier_label ?? ""));
  const recoNote = reco
    ? `If it were my own week on the water, I would take ${e(reco.name)} for this brief. `
    : "";
  return `
<div class="page"><div class="pad" style="display:flex;flex-direction:column;">
  <div class="sec-title">The Selection at a Glance</div>
  <hr class="hair" style="margin:5mm 0 2mm;">
  <table class="cmp">
    <tr><th>Yacht</th><th>Type &amp; Tier</th><th>Dates</th><th style="text-align:right;">Estimated All-In</th></tr>
    ${rows}
  </table>
  <div class="cmp-note">${recoNote}Reply with the one or two names that speak to you, and I will confirm live availability the same day.</div>
  <div class="cmp-fine">${anyDiscount
    ? "Estimated all-in figures include the charter fee after the offered discount, APA and VAT at each yacht's certified rate."
    : "Estimated all-in figures include the charter fee, APA and VAT at each yacht's certified rate."} Crew gratuity is discretionary and not included. Rates and availability move daily in season; every option is subject to owner confirmation at the moment of booking.</div>
  <div style="margin-top:auto;"></div>
  <div class="pfoot"><span>${confLabel(d.white_label)}${d.white_label ? "" : " &#8226; WhatsApp +1 786 798 8798"}</span><span>${e(d.period ?? "")}</span></div>
</div></div>`;
}

// "A Week Like This" — George writes every itinerary himself (2026-07-15:
// the canned area-matched routes are GONE — they could never cover "the
// client wants Syros"). This renders his custom weeks, max 2 pages, in the
// exact page style the canned ones used. No weeks => no pages.
// "THE MEAD EDITION" — magazine-issue masthead on the cover (2026-07-16,
// George's GO on the proposal-upgrade wave). The proposal reads as a private
// publication printed for one family. Falls back to the classic label when
// no client surname is known (incl. white-label covers, whose client name is
// deliberately absent).
function editionMasthead(clientName?: string | null): string {
  const raw = String(clientName ?? "").trim();
  const words = raw
    .replace(/\b(mr|mrs|ms|miss|dr|capt|sir|the|family)\.?\b/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const surname = words.length ? words[words.length - 1] : "";
  if (surname.length < 2) return `<div class="label">Confidential Charter Proposal</div>`;
  return `<div class="label" style="font-size:10.5pt;letter-spacing:.34em;">The ${e(surname)} Edition</div>
      <div class="label dim" style="font-size:6.5pt;margin-top:1.6mm;">Confidential Charter Proposal &#8226; a private publication of one</div>`;
}

function customWeekPages(d: CombinedProposal): string[] {
  const weeks = (d.custom_weeks ?? []).slice(0, 2);
  return weeks
    .filter((wk) => (wk.title || "").trim() && (wk.days ?? []).some((x) => (x.leg || "").trim()))
    .map((wk) => {
      const rows = (wk.days ?? [])
        .filter((x) => (x.leg || "").trim())
        .slice(0, 8)
        .map(({ leg, note }, i) => {
          // "Athens -> Syros" typed in the panel becomes the typographic arrow.
          const legHtml = e(leg.trim()).replace(/\s*(?:-&gt;|→)\s*/g, " &rarr; ");
          return `<tr><td class="w-day">Day ${i + 1}</td><td class="w-leg">${legHtml}</td><td>${e((note || "").trim())}</td></tr>`;
        })
        .join("");
      return `
<div class="page"><div class="pad" style="display:flex;flex-direction:column;">
  <div class="sec-title">A Week Like This &mdash; ${e(wk.title.trim())}</div>
  <hr class="hair" style="margin:5mm 0 2mm;">
  <p class="body" style="font-size:9.5pt;line-height:1.6;margin-top:3mm;color:var(--ivory-dim);">
    A sample rhythm for the week, drawn from routes we actually run. Every day is adjusted on board
    around your pace, the wind and the water; nothing is fixed except that the itinerary is yours.</p>
  <table class="wk">${rows}</table>
  <div style="margin-top:auto;"></div>
  <div class="pfoot"><span>${confLabel(d.white_label)}${d.white_label ? "" : " &#8226; WhatsApp +1 786 798 8798"}</span><span>${e(d.period ?? "")}</span></div>
</div></div>`;
    });
}

// RETIRED auto sample weeks (kept as data reference for George's own writing;
// no code path reads this anymore).
/* const SAMPLE_WEEKS: { key: RegExp; title: string; days: [string, string, string][] }[] = [
  {
    key: /cyclad|mykonos|paros|santorini|milos|sifnos|syros|naxos/i,
    title: "The Cyclades",
    days: [
      ["Day 1", "Athens &rarr; Kythnos", "Settle in underway; first swim at the double-sided sandbar of Kolona."],
      ["Day 2", "Kythnos &rarr; Serifos", "Morning passage; evening beneath the whitewashed chora."],
      ["Day 3", "Serifos &rarr; Milos", "The volcanic sculptures of Kleftiko by tender; night at Adamas."],
      ["Day 4", "Milos &rarr; Sifnos", "A protected bay, a slow lunch, dinner ashore in the pottery village."],
      ["Day 5", "Sifnos &rarr; Paros", "Cross to the lively side; cocktails in Naoussa's old harbour."],
      ["Day 6", "Paros &rarr; Kythnos", "The long reach home; last night at the thermal-spring harbour of Loutra."],
      ["Day 7", "Kythnos &rarr; Athens", "Lunch at sea; alongside by late afternoon."],
    ],
  },
  {
    key: /saronic|hydra|spetses|poros|aegina|athens/i,
    title: "The Saronic Gulf",
    days: [
      ["Day 1", "Athens &rarr; Aegina", "The city fades in under an hour; swim off Moni islet."],
      ["Day 2", "Aegina &rarr; Poros", "Russian Bay afternoon; evening under the clock tower."],
      ["Day 3", "Poros &rarr; Hydra", "Anchor off Mandraki; a night in the car-free harbour town."],
      ["Day 4", "Hydra &rarr; Spetses", "Swim stop at uninhabited Dokos; Old Harbour dinner."],
      ["Day 5", "Spetses &rarr; Porto Cheli", "The lazy day: toys in the water, a lunch that never quite ends."],
      ["Day 6", "Porto Cheli &rarr; Aegina", "North with a lunch stop at anchor; seafood in Perdika."],
      ["Day 7", "Aegina &rarr; Athens", "A final morning swim; alongside by early afternoon."],
    ],
  },
  {
    key: /ionian|corfu|lefkada|kefalonia|zakynthos|paxos|ithaca/i,
    title: "The Ionian",
    days: [
      ["Day 1", "Corfu &rarr; Paxos", "Green water and olive groves; evening in Gaios harbour."],
      ["Day 2", "Paxos &rarr; Antipaxos", "The blue caves and Voutoumi beach; night back at Gaios."],
      ["Day 3", "Paxos &rarr; Parga", "The mainland's amphitheatre town; castle walk at dusk."],
      ["Day 4", "Parga &rarr; Sivota", "Island-studded bays made for a long swim stop."],
      ["Day 5", "Sivota &rarr; Lefkada", "The west-coast beaches; sunset off Egremni."],
      ["Day 6", "Lefkada &rarr; Meganisi", "Quiet coves and a family taverna on the quay."],
      ["Day 7", "Meganisi &rarr; Lefkada", "Short morning leg; disembark rested."],
    ],
  },
  {
    key: /dodecan|rhodes|symi|kos|patmos|leros|kalymnos/i,
    title: "The Dodecanese",
    days: [
      ["Day 1", "Rhodes &rarr; Symi", "One hour to Pedi Bay; evening in the amphitheatre harbour."],
      ["Day 2", "Symi &rarr; Kos", "Morning at St George Bay; evening promenade in Kos town."],
      ["Day 3", "Kos &rarr; Kalymnos", "The sponge-divers' island; afternoon swim at Vlychadia."],
      ["Day 4", "Kalymnos &rarr; Leros", "Lunch in a quiet bay; evening at Panteli."],
      ["Day 5", "Leros &rarr; Patmos", "The holy island; waterfront dinner in Skala."],
      ["Day 6", "Patmos &rarr; Lipsi", "Small-island day: turquoise coves and total quiet."],
      ["Day 7", "Lipsi &rarr; Rhodes", "The homeward run with a lunch stop on the way."],
    ],
  },
];
*/

function renderCombined(d: CombinedProposal): string {
  const pages: string[] = [];
  const yachts = d.yachts ?? [];
  const client = d.client_name;
  const intro = d.intro_letter ?? "";

  // ---- COVER + intro letter ----
  const cover = (d.images ?? {}).cover;
  const bg = cover
    ? `<div class='bleed' style="background-image:url(${cover})"></div><div class='bleed-tint'></div>`
    : `<div class='bleed placeholder'></div><div class='ph-corner'>Image &#8226; full-bleed cover</div>`;
  const introParas = intro
    .split("\n")
    .filter((t) => t.trim())
    .map((t) => `<p style='margin-bottom:3.5mm;'>${e(t)}</p>`)
    .join("");
  const guestsLabel = (() => {
    const g = (d.guests ?? "").toString().trim();
    if (!g) return "";
    return /guest/i.test(g) ? g : `${g} Guests`;
  })();
  // Cover sub-line: George's own words when he wrote them; otherwise the
  // auto composition, GUARDED - a bloated guests/area field means an internal
  // note leaked into it (seen live: the whole brief printed under the client's
  // name), so any over-long part is dropped rather than published.
  const coverSub = (d.cover_line ?? "").trim()
    ? e((d.cover_line ?? "").trim().slice(0, 100))
    : [
        guestsLabel.length <= 24 ? e(guestsLabel) : "",
        (() => { const a = (d.area ?? "").toString().trim(); return a && a.length <= 48 ? e(a) : "Greek Waters"; })(),
        `${yachts.length} Yacht${yachts.length === 1 ? "" : "s"}`,
      ].filter(Boolean).join(" &#8226; ");
  pages.push(`
<div class="page">${bg}<div class="scrim-bottom"></div>
  <div class="scrim-bottom" style="background:linear-gradient(to bottom,rgba(9,20,32,.42) 0%,rgba(9,20,32,0) 24%);"></div>
  <div class="scrim-bottom" style="background:linear-gradient(to bottom,rgba(9,20,32,0) 34%,rgba(9,20,32,.55) 52%,rgba(9,20,32,.30) 70%,rgba(9,20,32,0) 84%);"></div>
  <div class="pad" style="display:flex;flex-direction:column;padding:22mm 18mm;">
    <div style="text-align:center;">${editionMasthead(d.client_name)}
      <div class="drule"><span></span>${DIAMOND}<span></span></div></div>
    <div style="margin-top:auto;text-align:center;">
      <div class="label dim">${e(cleanDateRange(d.period ?? "") || (d.period ?? ""))}</div>
      <h1 class="cinzel gold-metal" style="font-size:28pt;letter-spacing:.10em;color:var(--gold);margin:5mm 0;font-weight:700;text-shadow:0 2px 6mm rgba(9,20,32,.92),0 0 14mm rgba(9,20,32,.85);">
        ${client ? "Personally Curated for " + e(client) : "A Personally Curated Selection"}</h1>
      <div class="label dim" style="letter-spacing:.16em;">${coverSub}</div>
    </div>
    <div style="text-align:center;margin-top:auto;"><div class="label dim" style="font-size:6.5pt;">
      Confidential &#8226; Proprietary &#8226; Prepared solely for the named recipient</div></div>
  </div></div>`);

  if (introParas) {
    pages.push(`
<div class="page"><div class="pad">
  <div class="sec-title">A Note From Your Broker</div>
  <hr class="hair" style="margin:5mm 0 8mm;">
  <div class="body">${introParas}</div>
  ${d.white_label ? "" : `<div style="margin-top:10mm;">
    <div class="corm gold-metal" style="font-size:15pt;color:var(--gold);">George Biniaris</div>
    <div class="label" style="margin-top:1mm;font-size:7.5pt;">Managing Broker &#8226; George Yachts Brokerage House LLC</div>
  </div>`}
  <div class="pfoot"><span>${confLabel(d.white_label)}${d.white_label ? "" : " &#8226; WhatsApp +1 786 798 8798"}</span><span>${e(d.period ?? "")}</span></div>
</div></div>`);
  }

  // ---- the decision surface: selection at a glance (3+ yachts) ----
  const cmp = comparisonPage(d);
  if (cmp) pages.push(cmp);

  // ---- one page per yacht (caller sorts cheapest -> priciest) ----
  yachts.forEach((y, i) => pages.push(renderCombinedYacht(y, i + 1, d)));

  // ---- George's own itinerary pages (max 2; absent => none) ----
  for (const wkPage of customWeekPages(d)) pages.push(wkPage);

  // ---- key information / closing ----
  pages.push(keyInfoPage(d));
  // Append the per-yacht extras CSS ONLY when at least one yacht carries extras,
  // so a proposal without them is byte-identical to the pre-feature render.
  const anyExtras = yachts.some((y) => hasYachtExtras(y));
  // Append the PERIODS CSS ONLY when at least one yacht carries period options,
  // so a proposal without them is byte-identical to the pre-feature render.
  const anyPeriods = yachts.some((y) => hasPeriodOptions(y));
  return wrapPages(
    pages,
    d.white_label ? "Charter Proposal" : "Curated Selection" + (client ? ` - ${client}` : ""),
    (anyExtras ? EXTRAS_CSS : "") + (anyPeriods ? PERIODS_CSS : "") + HELM_V2_CSS,
  );
}

// Large framed hero photo for a content page. Near full content width, gold
// hairline frame, gradient scrim + vignette baked into CSS. h = CSS height.
function heroPhoto(src: string | null | undefined, label: string, h: string, aspect?: number | null): string {
  if (src) {
    // Portrait-ish photo in a wide frame: cover-cropping shows a mast and
    // sky. Render the WHOLE photo (contain) over a blurred, darkened copy of
    // itself - the editorial letterbox. Landscape keeps the existing cover.
    if (aspect && aspect < 1.25) {
      return `<div class="photo photo-fit" style="height:${h};">
        <div class="pf-bg" style="background-image:url(${src});"></div>
        <div class="pf-img" style="background-image:url(${src});"></div>
      </div>`;
    }
    return `<div class="photo" style="height:${h};background-image:url(${src});"></div>`;
  }
  return `<div class="photo placeholder" style="height:${h};"><div class="ph-mark">${e(label)}</div></div>`;
}

function renderCombinedYacht(y: CombinedYacht, idx: number, d: CombinedProposal): string {
  const pr = computePricing(y.pricing);
  const imgs: Images = y.images ?? {};

  // --- tier eyebrow (restyled capsule) ---
  const tier = y.tier_label;
  const tierHtml = tier
    ? `<div class="tier-eyebrow"><span class="t-rule"></span><span class="t-word">${e(tier)}</span><span class="t-rule"></span></div>`
    : "";

  // --- inside info, sentence-boundary trimmed (no mid-clause dangle), capped to
  // ~3 lines so it can never push the pricing panel off the bottom of the page. ---
  const inside = y.inside_info ? trimToSentence(y.inside_info, 240) : "";
  // Crew line (Helm v2 #3): roles/credentials only (composer strips names),
  // always with the owner-confirmation footnote so a crew change is never a
  // broken promise. Absent => nothing renders and the layout is unchanged.
  const crewClean = y.crew_line ? trimToSentence(y.crew_line, 170) : "";
  const crewHtml = crewClean
    ? `<div class="crewline">
         <span class="c-lab">Crew</span><span class="c-txt">${e(crewClean)}</span>
         <div class="c-note">Crew composition is indicative and remains subject to the owner&#8217;s final confirmation.</div>
       </div>`
    : "";
  const insideHtml = inside
    ? `<div class="inside">
         <div class="i-lab">${d.white_label ? "Inside Info" : "George&#8217;s Inside Info"}</div>
         <p class="i-body">${e(inside)}</p>
       </div>`
    : "";

  // --- voyage line: round-trip aware + clean dates ---
  const voyage = formatVoyage(y.voyage_line);
  // Split voyage into route + dates for the two-cell deal header.
  let routePart = voyage;
  let datesPart = "";
  const vdot = voyage.indexOf(" · ");
  if (vdot !== -1) {
    routePart = voyage.slice(0, vdot).trim();
    datesPart = voyage.slice(vdot + 3).trim();
  }

  // --- charter type (default weekly = unchanged render) ---
  const ctype = charterType(d);

  // --- structured per-yacht bareboat extras (this yacht's OWN payable-at-base /
  // security deposit / complimentary on-board). When present they DRIVE the
  // money-box extras and REPLACE the generic opt-in placeholder note. ---
  const yExtras = yachtExtrasBlock(y);
  const yHasExtras = hasYachtExtras(y);

  // --- "THE DOUBLE": this yacht quoted across 2+ durations. When present the
  // money box renders the compact PERIODS & RATES table INSTEAD of the single
  // charter-fee/all-in rows. Absent => the existing single-pricing money box is
  // rendered EXACTLY as before. ---
  const periodsHtml = periodOptionsBlock(y);
  const yHasPeriods = !!periodsHtml;
  // A computed per-period BREAKDOWN table is taller than the simple period list,
  // so the hero photo shrinks a touch more on those pages to keep one A4 page.
  const yHasBreakdown = yHasPeriods && wantsBreakdown(validPeriodOptions(y));

  // --- pricing rows for the deal panel ---
  let dealRows: string;
  let dealTotal = "";
  if (pr.day_charter) {
    // DAY CHARTER — two FINAL all-in rates (half day / full day), each as a
    // row. No APA/VAT/all-in total; per-guest is auto-omitted (per_person null).
    dealRows = pr.rows
      .map(([l, a]) => `<div class="deal-row"><span>${e(l)}</span><span class="d-amt">${a}</span></div>`)
      .join("");
    dealTotal = "";
  } else if (ctype !== "weekly") {
    // BAREBOAT / DAILY / CUSTOM — Charter fee is the headline figure (label
    // "Charter fee", NOT "all-in"; bareboat fee already includes VAT). NO
    // APA / VAT-extra rows, NO all-in total. When a discount applies, the
    // CLIENT figure is the POST-discount net (the client NEVER sees the gross
    // list as the price); the list is shown only as a quiet struck "was" note,
    // and the discount line confirms the saving. Commission / price-to-agency
    // is INTERNAL and never reaches this template at all. When this yacht has
    // its OWN structured extras (payable-at-base / deposit / on-board) they
    // render as a dedicated block below and REPLACE the generic placeholder.
    const feeFigure = pr.net_after_discount || pr.charter_fee_disp || pr.headline;
    const wasNote = pr.net_after_discount && pr.charter_fee_disp
      ? `<div class="deal-row muted"><span>List rate</span><span class="d-amt" style="text-decoration:line-through;opacity:.7;">${pr.charter_fee_disp}</span></div>`
      : "";
    dealRows =
      `<div class="deal-row"><span>Charter fee</span><span class="d-amt">${feeFigure}</span></div>` +
      wasNote +
      (pr.discount_note ? `<div class="deal-row muted"><span>${e(pr.discount_note)}</span><span class="d-amt"></span></div>` : "") +
      (yHasExtras ? "" : combinedExtraRows(ctype, d.terms));
    dealTotal = "";
  } else if (pr.all_inclusive) {
    dealRows =
      `<div class="deal-row"><span>All-inclusive charter</span><span class="d-amt">${pr.all_in}</span></div>` +
      `<div class="deal-row muted"><span>APA, VAT &amp; extras</span><span class="d-amt">Included</span></div>`;
    dealTotal = pr.all_in
      ? `<div class="deal-total"><span class="dt-lab">All-In</span><span class="dt-amt gold-metal">${pr.all_in}</span></div>`
      : "";
  } else if (pr.extras_mode) {
    dealRows =
      `<div class="deal-row"><span>Charter fee</span><span class="d-amt">${pr.charter_fee_disp}</span></div>` +
      `<div class="deal-row muted"><span>Operating expenses</span><span class="d-amt">${e(y.pricing?.extras_text ?? "plus expenses")}</span></div>`;
  } else {
    const crows = pr.rows
      .map(([l, a]) => `<div class="deal-row"><span>${e(l)}</span><span class="d-amt">${a}</span></div>`)
      .join("");
    dealRows =
      `<div class="deal-row"><span>Charter fee</span><span class="d-amt">${pr.charter_fee_disp}</span></div>` +
      (pr.discount_note ? `<div class="deal-row muted"><span>${e(pr.discount_note)}</span><span class="d-amt"></span></div>` : "") +
      crows;
    dealTotal = pr.all_in
      ? `<div class="deal-total"><span class="dt-lab">Estimated All-In</span><span class="dt-amt gold-metal">${pr.all_in}</span></div>`
      : "";
  }
  // Per-guest is omitted when multiple periods are shown — a single per-guest
  // figure would be ambiguous across two different fees, and the periods table
  // is the headline. (Single-pricing yachts keep the existing per-guest line.)
  const perGuest = (SHOW_PER_GUEST && !yHasPeriods && pr.per_person_4)
    ? `<div class="deal-foot">Per guest, estimated: ${pr.per_person_4} at 4 &#8226; ${pr.per_person_6} at 6</div>`
    : "";

  // Deal header cells: Route + Dates (only render a cell when we have content).
  const headCells =
    (routePart
      ? `<div class="deal-cell"><div class="d-lab">Itinerary</div><div class="d-val">${e(routePart)}</div></div>`
      : "") +
    (datesPart
      ? `<div class="deal-cell"><div class="d-lab">Dates</div><div class="d-val">${e(datesPart)}</div></div>`
      : "");
  const dateNote = (y.date_note ?? "").toString().trim();
  const dealHead =
    (headCells ? `<div class="deal-head">${headCells}</div>` : "") +
    (dateNote
      ? `<div class="deal-datenote">${e(trimToSentence(dateNote, 140))}</div>`
      : "");

  // spec_strip: a [label,value][] of vessel facts. We render it ONLY when the
  // entries are well-formed (a real multi-char label AND value) — this kills the
  // legacy "garbled single-letter" bug, where a malformed strip rendered as
  // "L e / M o / M a". Bad / empty data simply produces no strip.
  const stripValid = (y.spec_strip ?? []).filter(
    (s) =>
      Array.isArray(s) &&
      typeof s[0] === "string" && s[0].trim().length >= 2 &&
      typeof s[1] === "string" && s[1].trim().length >= 1,
  );
  const stripHtml = stripValid.length
    ? `<div class="spec-strip">${stripValid
        .slice(0, 4)
        .map(
          (s) =>
            `<div class="ss-cell"><div class="ss-lab">${e(s[0].trim())}</div>` +
            `<div class="ss-val">${e(s[1].trim())}</div></div>`,
        )
        .join("")}</div>`
    : "";

  const idx2 = String(idx).padStart(2, "0");
  const specClean = cleanSpecLine(y.spec_line);
  const desc = y.description ? trimToSentence(y.description, 360) : "";

  // Reserve a safe band at the foot of the page (padding-bottom 26mm vs the base
  // 20mm) so the deal panel's flow content always stops ABOVE the .pfoot footer
  // (which sits at bottom:12mm). Belt-and-braces with the budgeted block heights.
  return `
<div class="page"><div class="pad" style="display:flex;flex-direction:column;padding-bottom:26mm;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <div style="flex:1;">
      ${tierHtml}
      <div class="label dim" style="font-size:7pt;margin-top:${tier ? "3mm" : "0"};">${e(y.type ?? "")}</div>
      <h2 class="cinzel gold-metal" style="font-size:22pt;letter-spacing:.08em;color:var(--gold);font-weight:700;margin-top:1.2mm;line-height:1.05;">${e(y.name)}</h2>
    </div>
    <div class="corm" style="font-size:34pt;color:rgba(201,168,76,.22);font-weight:600;line-height:1;margin-left:6mm;">${idx2}</div>
  </div>
  ${specClean ? `<div class="body" style="font-size:9.5pt;letter-spacing:.04em;color:var(--ivory-dim);margin-top:1.6mm;line-height:1.5;">${e(specClean)}</div>` : ""}
  ${stripHtml}

  ${(() => {
    // Optional 3-up gallery strip under the hero. Renders ONLY when extra
    // photos exist AND the money box is the simple one (extras / periods /
    // breakdown pages keep the taller hero and skip the strip so the page
    // still clears the footer). Hero shrinks to make room: 88 -> 60mm.
    const gpics = [imgs.g1, imgs.g2, imgs.g3].filter(Boolean) as string[];
    // The strip is skipped ONLY under the tall per-period breakdown table
    // (there is genuinely no room). Extras / simple periods just shrink the
    // hero further - a relocation-fee row must not cost the client three
    // photos (found live on the Farnham proposal, 2026-07-15).
    const crewPad = (crewClean ? 9 : 0) + (dateNote ? 5 : 0);
    const extrasPad = (yHasExtras ? 10 : 0) + (yHasPeriods && !yHasBreakdown ? 12 : 0);
    if (gpics.length && !yHasBreakdown) {
      const cells = gpics
        .slice(0, 3)
        .map((g) => `<div class="ps" style="background-image:url(${g});"></div>`)
        .join("");
      const h = Math.max(34, 60 - crewPad - extrasPad);
      return `<div style="margin-top:4.5mm;">${heroPhoto(imgs.main, "Yacht image", `${h}mm`, y.main_aspect)}</div><div class="pstrip">${cells}</div>`;
    }
    const h = yHasBreakdown ? 74 - crewPad : Math.max(40, 88 - crewPad - extrasPad);
    return `<div style="margin-top:4.5mm;">${heroPhoto(imgs.main, "Yacht image", `${h}mm`, y.main_aspect)}</div>`;
  })()}

  ${desc ? `<p class="body" style="font-size:10.5pt;line-height:1.6;margin-top:4mm;">${e(desc)}</p>` : ""}
  ${insideHtml}
  ${crewHtml}

  <div class="deal">
    ${dealHead}
    ${yHasPeriods
      ? periodsHtml
      : `<div class="deal-rows">${dealRows}${dealTotal}</div>${yExtras}
    ${perGuest}`}
    ${brochureLink(y.links)}
  </div>

  <div class="pfoot"><span>${confLabel(d.white_label)}${d.white_label ? "" : " &#8226; WhatsApp +1 786 798 8798"}</span><span>${e(d.period ?? "")} &#8226; ${idx2}</span></div>
</div></div>`;
}

// COMBINED — OWNER-DRIVEN Key Information page (section 1). When the owner
// supplied any `terms` content this DRIVES the last page: only the present
// sections render, each absent one omitted. Two-column label/body styling +
// footer (white-label aware) + the "A Personal Service" cell are kept for
// cohesion. NO charter-type default boilerplate.
function keyInfoPageTerms(d: CombinedProposal): string {
  const cells = ownerTermsCells(d.terms!, d.crew_note);
  return `
<div class="page"><div class="pad" style="display:flex;flex-direction:column;">
  <div class="sec-title">Key Information</div>
  <hr class="hair" style="margin:5mm 0 8mm;">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8mm;">
    ${cells}
    <div><div class="label">A Personal Service</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Every option here has been selected by hand. We are with you from
    first enquiry to disembarkation, on the ground in Greece, and a message away at any hour.</p></div>
  </div>
  <div style="margin-top:auto;">${footerBlock(d)}</div>
</div></div>`;
}

function keyInfoPage(d: CombinedProposal): string {
  const ctype = charterType(d);
  // WEEKLY / crewed: ALWAYS the polished, generic, accurate Key Information page
  // (APA explainer + crew gratuity + MYBA payment). It never echoes request-specific
  // "included / not included" wording, so it can never contradict the actual offer
  // (the cause of a real client query). Owner terms no longer override it for weekly.
  if (ctype === "weekly") return keyInfoPageWeekly(d);
  // Non-weekly: owner-supplied terms win when present; otherwise the type default.
  if (termsHasContent(d.terms)) return keyInfoPageTerms(d);
  return keyInfoPageNonWeekly(d, ctype);
}

// COMBINED — WEEKLY / crewed Key Information page. Generic + accurate by design:
// explains the APA (definition, ~20-40% range, what it funds, refundable / top-up,
// Captain-managed) and the MYBA payment cadence, with a small footnote that the
// payment terms are the MYBA standard. NO request-specific included / not-included
// list, so the page can never contradict the quoted offer. Figures are general
// market norms, never a commitment tied to any one deal.
function keyInfoPageWeekly(d: CombinedProposal): string {
  const noMyba = d.no_myba ?? false;
  const payment = noMyba
    ? ""
    : `
      <div><div class="label">Payment</div>
      <p class="body" style="font-size:9pt;margin-top:2mm;">Typically 50% of the net charter fee on signing the MYBA agreement, with the
      remaining 50%, plus VAT, the APA and any extras, due around four to five weeks before embarkation. Availability is confirmed only
      at the moment of booking.</p>
      <p class="body" style="font-size:7pt;color:var(--ivory-dim);margin-top:2mm;line-height:1.45;">These payment terms follow the MYBA
      standard agreement, under which the great majority of charters are contracted; other contract forms are used on occasion.</p></div>`;
  return `
<div class="page"><div class="pad" style="display:flex;flex-direction:column;">
  <div class="sec-title">Key Information</div>
  <hr class="hair" style="margin:5mm 0 8mm;">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8mm;">
    <div><div class="label">What is the APA?</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">The Advance Provisioning Allowance is a running budget held separately from the
    charter fee, typically between 20% and 40% of it, depending on the yacht, the number of guests and how you cruise. It funds the
    expenses of the charter itself: fuel, berthing and port fees, food and beverages, and similar running costs. The Captain holds it
    and settles each expense on your behalf, so nothing is paid item by item and the charter runs seamlessly, with a full account kept
    throughout. Whatever remains unspent is returned to you, and on the rare occasion the cruising exceeds it, the difference is simply
    topped up along the way.</p></div>
    ${payment}
    <div><div class="label">Crew Gratuity</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">A gratuity for the crew is never included in the rate and is entirely at your
    discretion. Where the service has delighted, the customary token is in the region of 10% to 15% of the charter fee, offered to the
    Captain at the close of the charter.</p></div>
    <div><div class="label">A Personal Service</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Every option here has been selected by hand. We are with you from
    first enquiry to disembarkation, on the ground in Greece, and a message away at any hour.</p></div>
  </div>
  <div class="next-band">
    <div class="n-lab">What Happens Next</div>
    <div class="n-steps">
      <div class="n-step"><div class="n-num">1</div>Reply with the one or two yachts that speak to you &mdash; a single line is enough.</div>
      <div class="n-step"><div class="n-num">2</div>We confirm live availability with each owner the same day and hold nothing without your go-ahead.</div>
      <div class="n-step"><div class="n-num">3</div>On your word, the MYBA agreement is issued and your dates are secured.</div>
    </div>
  </div>
  <div style="margin-top:auto;">${footerBlock(d)}</div>
</div></div>`;
}

// COMBINED — type-appropriate "Key Information" page for bareboat / daily /
// custom. Replaces the weekly APA / MYBA / crew-gratuity boilerplate. NO APA,
// NO MYBA e-contract, NO crew-gratuity wording. Payment is flexible ("to be
// confirmed per yacht"). The proposal-level crew/extras note (when set) renders
// verbatim. The "A Personal Service" cell + footer are kept for cohesion (the
// footer respects white-label).
function keyInfoPageNonWeekly(d: CombinedProposal, ctype: CharterType): string {
  const noteVerbatim = (d.crew_note ?? "").toString().trim();
  const noteCell = noteVerbatim
    ? `<div><div class="label">Crew &amp; Extras</div>
       <p class="body" style="font-size:9pt;margin-top:2mm;color:var(--gold-soft);">${e(noteVerbatim)}</p></div>`
    : "";

  let cells: string;
  if (ctype === "bareboat") {
    cells = `
    <div><div class="label">What is Included</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Use of the yacht and her equipment, marine insurance, and
    applicable taxes &amp; VAT.</p></div>
    <div><div class="label">Not Included</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Fuel, water, food &amp; drinks, port fees and personal
    expenses, which are all extra.</p></div>
    <div><div class="label">Obligatory Extras</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Paid locally per the operator, for example end cleaning,
    transit log and a damage waiver.</p></div>
    <div><div class="label">Security Deposit</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">A refundable security deposit is held and returned after
    disembarkation, less any damage.</p></div>
    <div><div class="label">Skipper &amp; Licence</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">A valid skipper&#8217;s licence is required for bareboat; a
    professional skipper can be arranged on request.</p></div>
    <div><div class="label">Payment</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">To be confirmed per yacht.</p></div>`;
  } else if (ctype === "daily") {
    cells = `
    <div><div class="label">What is Included</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">The cruising hours and route for the day, with inclusions as
    detailed per the operator.</p></div>
    <div><div class="label">Optional Extras</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Water sports and similar are available on request and noted
    where included.</p></div>
    <div><div class="label">Payment</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">To be confirmed.</p></div>`;
  } else {
    // custom — neutral, flexible
    cells = `
    <div><div class="label">The Charter Period</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Rates are for the agreed charter period. Inclusions and any
    extras are as detailed per the operator.</p></div>
    <div><div class="label">Payment</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">To be confirmed.</p></div>`;
  }

  return `
<div class="page"><div class="pad" style="display:flex;flex-direction:column;">
  <div class="sec-title">Key Information</div>
  <hr class="hair" style="margin:5mm 0 8mm;">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8mm;">
    ${cells}
    ${noteCell}
    <div><div class="label">A Personal Service</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Every option here has been selected by hand. We are with you from
    first enquiry to disembarkation, on the ground in Greece, and a message away at any hour.</p></div>
  </div>
  <div style="margin-top:auto;">${footerBlock(d)}</div>
</div></div>`;
}

// ----------------------------------------------------------------- entry
export function buildProposalHtml(d: ProposalJson): string {
  return d.mode === "combined" ? renderCombined(d) : renderSingle(d);
}
