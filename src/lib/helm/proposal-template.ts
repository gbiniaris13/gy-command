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

import { computePricing, type PricingInput } from "./pricing";
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
 *  "7 nights"; dates e.g. "31 Aug – 5 Sep 2026"; fee_disp the formatted client
 *  fee e.g. "€ 15,000"; note an optional muted sub-line e.g. "8% offer, from
 *  € 24,000". Never carries commission / price-to-agency. */
export type PeriodOption = { label: string; dates?: string; fee_disp: string; note?: string };

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
    .replace(/[ ]?T[ ]?(?=\d)/g, " ")
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
  const s = (input ?? "").trim();
  if (!s) return "";
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
  return `<a class="deal-brochure" href="${e(url)}">Digital Brochure <span class="db-arrow">&#8599;</span></a>`;
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
      &copy; 2026 George Yachts Brokerage House LLC. Confidential and proprietary &mdash; prepared exclusively for the named recipient.
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
      Confidential and proprietary &mdash; prepared solely for the named recipient. Indicative only; not a binding contract.<br>
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
        port fees and personal expenses — these are extra.</p>
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
function validPeriodOptions(y: CombinedYacht): PeriodOption[] {
  return (Array.isArray(y.period_options) ? y.period_options : [])
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      label: (p.label ?? "").toString().trim(),
      dates: (p.dates ?? "").toString().trim(),
      fee_disp: (p.fee_disp ?? "").toString().trim(),
      note: (p.note ?? "").toString().trim(),
    }))
    // An option is renderable when it has at least a fee OR a label (so a robust
    // merge that only captured the fee, or only the label, still shows up).
    .filter((p) => p.fee_disp || p.label);
}

function hasPeriodOptions(y: CombinedYacht): boolean {
  return validPeriodOptions(y).length > 0;
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
    `<div class="po-foot">Each rate is plus APA (estimated 35&#8211;40%), VAT 12%, and crew gratuity 10&#8211;15% as per MYBA.</div>` +
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
  if (ctype !== "weekly") {
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
  const perPerson = pr.per_person_4
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
  pages.push(`
<div class="page">${bg}<div class="scrim-bottom"></div>
  <div class="scrim-bottom" style="background:linear-gradient(to bottom,rgba(9,20,32,.42) 0%,rgba(9,20,32,0) 24%);"></div>
  <div class="pad" style="display:flex;flex-direction:column;padding:22mm 18mm;">
    <div style="text-align:center;"><div class="label">Confidential Charter Proposal</div>
      <div class="drule"><span></span>${DIAMOND}<span></span></div></div>
    <div style="margin-top:auto;text-align:center;">
      <div class="label dim">${e(cleanDateRange(d.period ?? "") || (d.period ?? ""))}</div>
      <h1 class="cinzel gold-metal" style="font-size:28pt;letter-spacing:.10em;color:var(--gold);margin:5mm 0;font-weight:700;">
        ${client ? "Personally Curated for " + e(client) : "A Personally Curated Selection"}</h1>
      <div class="label dim" style="letter-spacing:.16em;">${[guestsLabel, e(d.area ?? "Greek Waters"), `${yachts.length} Yachts`].filter(Boolean).join(" &#8226; ")}</div>
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
  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(d.period ?? "")}</span></div>
</div></div>`);
  }

  // ---- one page per yacht (caller sorts cheapest -> priciest) ----
  yachts.forEach((y, i) => pages.push(renderCombinedYacht(y, i + 1, d)));

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
    (anyExtras ? EXTRAS_CSS : "") + (anyPeriods ? PERIODS_CSS : ""),
  );
}

// Large framed hero photo for a content page. Near full content width, gold
// hairline frame, gradient scrim + vignette baked into CSS. h = CSS height.
function heroPhoto(src: string | null | undefined, label: string, h: string): string {
  if (src) {
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

  // --- pricing rows for the deal panel ---
  let dealRows: string;
  let dealTotal = "";
  if (ctype !== "weekly") {
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
  const perGuest = (!yHasPeriods && pr.per_person_4)
    ? `<div class="deal-foot">Per guest, estimated — ${pr.per_person_4} at 4 &#8226; ${pr.per_person_6} at 6</div>`
    : "";

  // Deal header cells: Route + Dates (only render a cell when we have content).
  const headCells =
    (routePart
      ? `<div class="deal-cell"><div class="d-lab">Itinerary</div><div class="d-val">${e(routePart)}</div></div>`
      : "") +
    (datesPart
      ? `<div class="deal-cell"><div class="d-lab">Dates</div><div class="d-val">${e(datesPart)}</div></div>`
      : "");
  const dealHead = headCells ? `<div class="deal-head">${headCells}</div>` : "";

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

  <div style="margin-top:4.5mm;">${heroPhoto(imgs.main, "Yacht image", (yHasExtras || yHasPeriods) ? "80mm" : "88mm")}</div>

  ${desc ? `<p class="body" style="font-size:10.5pt;line-height:1.6;margin-top:4mm;">${e(desc)}</p>` : ""}
  ${insideHtml}

  <div class="deal">
    ${dealHead}
    ${yHasPeriods
      ? periodsHtml
      : `<div class="deal-rows">${dealRows}${dealTotal}</div>${yExtras}
    ${perGuest}`}
    ${brochureLink(y.links)}
  </div>

  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(d.period ?? "")} &#8226; ${idx2}</span></div>
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
    first enquiry to disembarkation - on the ground in Greece, and a message away at any hour.</p></div>
  </div>
  <div style="margin-top:auto;">${footerBlock(d)}</div>
</div></div>`;
}

function keyInfoPage(d: CombinedProposal): string {
  // OWNER-DRIVEN last page wins when terms were supplied (any charter type).
  if (termsHasContent(d.terms)) return keyInfoPageTerms(d);
  // Non-weekly charter types get a type-appropriate Key Information page. The
  // weekly path below is byte-identical to the original.
  const ctype = charterType(d);
  if (ctype !== "weekly") return keyInfoPageNonWeekly(d, ctype);

  const noMyba = d.no_myba ?? false;
  const myba = noMyba
    ? ""
    : `
      <div><div class="label">Booking &amp; Payment</div>
      <p class="body" style="font-size:9pt;margin-top:2mm;">50% deposit on signing of the MYBA e-contract. The remaining
      50% + VAT + APA is due four weeks prior to embarkation. Availability is confirmed only at the moment of booking.</p></div>`;
  return `
<div class="page"><div class="pad" style="display:flex;flex-direction:column;">
  <div class="sec-title">Key Information</div>
  <hr class="hair" style="margin:5mm 0 8mm;">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8mm;">
    <div><div class="label">What is the APA?</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">The Advance Provisioning Allowance covers fuel, port fees,
    food and beverages. Any unspent funds are refunded after disembarkation with a full expense log from the Captain.</p></div>
    ${myba}
    <div><div class="label">Crew Gratuity</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Not included in any rate. The industry standard is 10-15% of
    the charter fee, handed to the Captain at disembarkation. Discretionary, but customary for excellent service.</p></div>
    <div><div class="label">A Personal Service</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Every option here has been selected by hand. We are with you from
    first enquiry to disembarkation - on the ground in Greece, and a message away at any hour.</p></div>
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
    expenses — these are extra.</p></div>
    <div><div class="label">Obligatory Extras</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Paid locally per the operator — for example end cleaning /
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
    first enquiry to disembarkation - on the ground in Greece, and a message away at any hour.</p></div>
  </div>
  <div style="margin-top:auto;">${footerBlock(d)}</div>
</div></div>`;
}

// ----------------------------------------------------------------- entry
export function buildProposalHtml(d: ProposalJson): string {
  return d.mode === "combined" ? renderCombined(d) : renderSingle(d);
}
