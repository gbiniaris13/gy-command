// src/lib/helm/extract.ts
// =============================================================
// PRICING SAFETY — the core of The Helm. The AI does NO arithmetic.
// It only EXTRACTS values literally present in the supplier email,
// each with its verbatim snippet + a confidence. George reviews and
// confirms every number on the review screen BEFORE compute_pricing
// runs (lib/helm/pricing.ts). Ambiguities are FLAGGED, never guessed.
//
// A wrong figure becomes a contract dispute — see
// render-kit/references/pricing-engine.md.
// =============================================================

import { aiChat } from "../ai";
import { parseLooseJson } from "./json";
import { fmtEur } from "./pricing";

export type Confidence = "high" | "medium" | "low";

export type Field<T> = {
  value: T | null;
  confidence: Confidence;
  /** Exact verbatim substring of supplier_raw this came from ("" if absent). */
  snippet: string;
};

export type ExtractedPricing = {
  currency: Field<string>;
  charter_fee: Field<number>;
  apa_pct: Field<number>;
  apa_amount: Field<number>;
  vat_pct: Field<number>;
  vat_amount: Field<number>;
  /** Set only for the "plus extras / plus expenses" lump case. */
  extras_text: Field<string>;
  /** Supplier "divide the rate by N" for a short charter. */
  divide_by: Field<number>;
  /** ONE fully-inclusive figure (APA+VAT+extras inside) when the supplier
   *  states "all included / fully inclusive / όλα μέσα / all-in". */
  all_inclusive_total: Field<number>;
  /** OPTIONAL discount the supplier offered off the list rate, as a percentage
   *  (e.g. "-18%", "18% discount" => 18). The CLIENT charter fee is the
   *  post-discount figure (computed deterministically downstream, never here). */
  discount_pct: Field<number>;
  /** OPTIONAL list / gross rate BEFORE any discount, when the supplier shows
   *  both a list price and a discounted/net price. */
  list_price: Field<number>;
  /** INTERNAL ONLY — the supplier's "price to agency" / "net to us" / commission
   *  figure or commission percentage. NEVER passed to the proposal / PDF; kept
   *  so the broker sees their margin on the review screen. The client only ever
   *  sees the post-discount charter fee. */
  commission_internal: Field<string>;
};

// PER-YACHT bareboat extras lifted verbatim from the supplier email (e.g.
// Vernicos-style "Payable at base", "Security deposit", complimentary items).
// FACTUAL, never invented; empty when the email does not state them. These flow
// into the yacht's money box ONLY — never the last page, never commission.
export type ExtractedYachtExtras = {
  /** [{label, amount}] — "Payable at base" / obligatory extras, each with its
   *  amount if stated (e.g. {label:"Charter Pack — …", amount:"EUR 250"}). */
  payable_at_base: { label: string; amount: string }[];
  /** Refundable deposit string as written (e.g. "EUR 3,000 refundable, card at base"). */
  security_deposit: string;
  /** Complimentary / free on-board items (e.g. ["1 SUP","Welcome Pack"]). */
  free_onboard: string[];
};

export type SeasonalRate = { label: string; fee: number; snippet: string };

export type ExtractionFlag = {
  code:
    | "MISSING_APA"
    | "MISSING_VAT"
    | "MULTIPLE_SEASONAL_RATES"
    | "DIVIDE_BY_UNCLEAR"
    | "PLUS_EXTRAS_NO_BREAKDOWN"
    | "NO_PRICE_FOUND"
    | "AMBIGUOUS";
  message: string;
};

// Factual content lifted verbatim from the supplier email — NEVER invented.
// Empty arrays / "" when the supplier did not state it. Not pricing, so no
// per-field snippet; the accuracy guard is "only what the supplier wrote".
export type ExtractedContent = {
  highlights: string[];
  accommodation: [string, string][];
  water_toys: string[];
  tech_specs: [string, string][];
  crew_line: string;
};

/** Charter product type the AI auto-detects from the email language (e.g. the
 *  word "Bareboat", "day charter", crewed/APA wording). The panel pre-selects
 *  it; the owner confirms or changes. Absent/unknown => the panel default. */
export type SuggestedCharterType = "weekly" | "bareboat" | "daily" | "custom";

/** Proposal-level last-page terms the AI SUGGESTS (owner edits/clears in the
 *  TermsEditor — never auto-final). All optional; empty when not stated. */
export type SuggestedTerms = {
  included?: string[];
  not_included?: string[];
  payment?: string;
  skipper?: string;
  cancellation?: string;
};

/** "THE DOUBLE": one quoted duration for a yacht the supplier offered across
 *  2+ durations. Built DETERMINISTICALLY by the post-extraction merge (NOT the
 *  AI) from each duplicate entry's dates + post-discount client fee. label e.g.
 *  "5 nights"; dates e.g. "31 Aug – 5 Sep 2026"; fee_disp e.g. "€ 15,000"; note
 *  e.g. "8% offer, from € 24,000". CLIENT-facing fee only — never commission. */
export type PeriodOption = { label: string; dates?: string; fee_disp: string; note?: string };

export type Extraction = {
  vessel_name: Field<string>;
  vessel_type: Field<string>;
  spec_line: Field<string>;
  pricing: ExtractedPricing;
  /** PER-YACHT bareboat extras (money-box only). Empty when not stated. */
  extras?: ExtractedYachtExtras;
  /** "THE DOUBLE": set ONLY by the deterministic merge when the supplier quoted
   *  this same yacht for 2+ durations. Each duplicate becomes one option here on
   *  the surviving base yacht; the duplicates are removed. Absent for a yacht
   *  quoted once (unchanged). */
  period_options?: PeriodOption[];
  seasonal_rates: SeasonalRate[];
  dates: { from: Field<string>; to: Field<string> };
  embarkation: Field<string>;
  disembarkation: Field<string>;
  content: ExtractedContent;
  /** AI's suggested pricing mode; George can override on the review screen. */
  suggested_mode?: "breakdown" | "plus_extras" | "all_inclusive";
  flags: ExtractionFlag[];
  notes: string;
};

/** Combined-extraction envelope: the per-yacht array PLUS proposal-level
 *  suggestions (auto-detected charter type + last-page terms). Additive: callers
 *  that only read the yacht array are unaffected. */
export type CombinedExtraction = {
  yachts: Extraction[];
  /** Auto-detected charter type for the whole proposal (panel pre-selects). */
  suggested_charter_type?: SuggestedCharterType;
  /** Suggested last-page terms (owner edits/clears). */
  suggested_terms?: SuggestedTerms;
};

const SYSTEM_PROMPT = `You extract structured data from a raw yacht central-agency email so a broker (George Yachts) can build a client proposal. You are an EXTRACTOR, not a calculator.

ABSOLUTE RULES — breaking these causes a contract dispute:
1. Extract ONLY values that appear LITERALLY in the email. Never calculate, infer, convert, or fill in a "reasonable" number. If a value is not explicitly written, its "value" is null.
2. Do NO arithmetic of any kind. Do not compute APA from a percentage, do not compute a VAT amount, do not compute any total or "all-in". Those are done later, deterministically, by code — never by you.
3. For every pricing field return: "value" (the number exactly as written, with currency symbols, spaces and thousands separators removed; e.g. "EUR 159,000" -> 159000), "confidence" ("high" = explicit and unambiguous, "medium" = needed light interpretation, "low" = unsure), and "snippet" (the EXACT verbatim substring of the email the value came from; "" if not found).

PRICING FIELDS:
- charter_fee: the NET charter rate for the stated period (usually weekly). If the email gives TWO OR MORE seasonal rates (e.g. June vs July/August), set charter_fee.value = null, list each in "seasonal_rates" (label + fee + snippet), and add flag MULTIPLE_SEASONAL_RATES — let the human pick.
- apa_pct AND apa_amount: capture whichever the supplier stated (percentage OR amount, not both unless both are written). If NEITHER appears, add flag MISSING_APA.
- vat_pct AND vat_amount: whichever stated. If neither, add flag MISSING_VAT.
- RANGES: if APA or VAT is quoted as a RANGE (e.g. "estimated at 35-40%", "20% to 40%", "35-40% APA", "APA varies from 20% to 40%"), DO capture it - use the HIGHER end as the percentage, set that field's confidence to "low", and put the full range text in its snippet so the broker confirms. Never leave it null just because it is a range.
- extras_text: set (e.g. "plus extras", "plus expenses") ONLY when the supplier gives a lump price with NO APA/VAT breakdown; also add flag PLUS_EXTRAS_NO_BREAKDOWN.
- all_inclusive_total: if the supplier states ONE fully-inclusive figure (e.g. "all included", "fully inclusive", "all-in", Greek "όλα μέσα"), capture that single number here and set "suggested_mode":"all_inclusive". In that case do NOT fill charter_fee/apa/vat, and do NOT raise MISSING_APA (there is no separate APA). Otherwise set suggested_mode to "breakdown" (normal fee+APA+VAT) or "plus_extras" (lump + extras).
- divide_by: if the supplier says to divide the weekly rate by a number for a short charter (e.g. "kindly divide by 6"), capture that N. If the request is clearly short but NO divisor is stated, set value null and add flag DIVIDE_BY_UNCLEAR.
- discount_pct: if the supplier offers a discount off the list rate as a percentage (e.g. "-18%", "18% discount", "less 18%"), capture that number (18). The client charter fee is the DISCOUNTED figure (code computes it; you do NOT). If the email shows a list price AND a discounted/net price, also fill list_price with the list/gross figure and charter_fee with the DISCOUNTED client figure.
- list_price: the list / gross rate BEFORE discount when both a list and a discounted price are shown.
- commission_internal: INTERNAL ONLY. If the email states a "price to agency", "net to us", "price to <agency>", commission amount or commission percentage (the broker's margin), capture it here as a STRING exactly as written (e.g. "EUR 4,041 to agency", "20% commission"). This is for the broker's eyes only. NEVER let any commission / price-to-agency figure appear in charter_fee, list_price, extras, content, notes, or anywhere client-facing. The client only ever sees the post-discount charter fee.
- currency: the currency code if stated (e.g. "EUR").
- If no price at all is found, add flag NO_PRICE_FOUND.

CHARTER TYPE (auto-detect): set "suggested_charter_type" to the product type the email describes — "bareboat" (the words "bareboat", "skippered/skipper optional", a security deposit + "payable at base" + no APA), "daily" ("day charter", "per day", a single-day cruise), "weekly" (a crewed weekly charter with APA / crew gratuity / MYBA language), or "custom" if unclear. The broker confirms it.

PER-YACHT EXTRAS (bareboat-style; FACTUAL, verbatim, leave empty if not stated) — these go in the yacht's money box, NOT the last page:
- extras.payable_at_base[]: items the charterer pays at the base (the supplier lists these under "Payable at base", "Obligatory extras", "Charter Pack", "End cleaning", "Transit log", etc.). Each as {"label":"<what it is, verbatim>","amount":"<amount as written, e.g. EUR 250>"} (amount "" if not stated).
- extras.security_deposit: the refundable security/damage deposit as written (e.g. "EUR 3,000 refundable, by card at base"). "" if not stated.
- extras.free_onboard[]: complimentary / free / included-on-board items (e.g. "1 SUP", "Welcome Pack", "Snorkelling gear"). [] if not stated.
- CATEGORISATION (do NOT mix these up):
  * A big "Equipment:", "On-Deck:", "Galley:", "Electrical:", "Entertainment:", "Sports Equipment:" list describes the YACHT'S OWN gear/features (A/C, autopilot, bow thruster, generator, solar, teak deck, coffee maker, etc.). Put the notable ones in content.highlights (tenders/toys in water_toys). These are NEVER charges — NEVER put equipment items in extras.payable_at_base.
  * extras.payable_at_base[] = ONLY items the charterer actually PAYS at the base, with a real amount (e.g. "Charter Pack EUR 250"). If an item under "Payable at base" says "included in price" / "included" / EUR 0, it is COMPLIMENTARY → put it in extras.free_onboard, NOT payable_at_base.
  * IGNORE any "Total (Payable at base)" SUM line — capture the individual line items only, never the total as its own item.
  * If the email states "Skipper licence required" (or similar), put that in suggested_terms.skipper (e.g. "Skipper licence required for bareboat; professional skipper on request"). Do not put it in extras.
For a CREWED weekly email these are normally empty (the APA model covers them) — leave them empty, do not invent.

LAST-PAGE TERMS (suggest only; the broker edits/clears them) — set "suggested_terms": {"included":[...],"not_included":[...],"payment":"...","skipper":"...","cancellation":"..."} from what the email states. Empty arrays / "" where not stated. For BAREBOAT, VAT is INCLUDED in the price — do NOT propose a separate VAT-extra row anywhere; if you note VAT, note it as included.

OTHER FIELDS (factual, verbatim where possible, no invention):
- vessel_name, vessel_type (e.g. "MOTOR YACHT", "SAILING CATAMARAN"), spec_line (short dot-separated: length/builder/year/refit).
- dates.from / dates.to: the charter window if stated (YYYY-MM-DD if derivable verbatim, else the literal text).
- embarkation / disembarkation: the embark and disembark ports if stated. "Athens to Mykonos" -> embarkation "Athens", disembarkation "Mykonos"; "Mykonos to Mykonos" -> both "Mykonos". If only a home port is given with no route, leave both null.
- content (FACTUAL, verbatim, NEVER invented; leave empty if not stated): highlights[] (selling points the supplier listed), accommodation[] (cabin -> description pairs), water_toys[] (toys/tenders listed), tech_specs[] (label -> value pairs: builder/length/beam/guests/cabins/crew/speed...), crew_line (one sentence about the crew if stated). If the supplier did not state something, leave it out - never fill it in.

CONFIDENTIALITY: never include the source agency/broker company name, person names, emails, phone numbers, or broker URLs ANYWHERE in your output. Strip them. NEVER surface commission / price-to-agency to any client-facing field — it lives ONLY in commission_internal.

OUTPUT: a SINGLE JSON object, no markdown fences, exactly this shape:
{"vessel_name":{"value":null,"confidence":"low","snippet":""},"vessel_type":{...},"spec_line":{...},"pricing":{"currency":{...},"charter_fee":{...},"apa_pct":{...},"apa_amount":{...},"vat_pct":{...},"vat_amount":{...},"extras_text":{...},"divide_by":{...},"all_inclusive_total":{...},"discount_pct":{...},"list_price":{...},"commission_internal":{"value":null,"confidence":"low","snippet":""}},"extras":{"payable_at_base":[],"security_deposit":"","free_onboard":[]},"seasonal_rates":[],"dates":{"from":{...},"to":{...}},"embarkation":{"value":null,"confidence":"low","snippet":""},"disembarkation":{"value":null,"confidence":"low","snippet":""},"content":{"highlights":[],"accommodation":[],"water_toys":[],"tech_specs":[],"crew_line":""},"suggested_mode":"breakdown","suggested_charter_type":"weekly","suggested_terms":{"included":[],"not_included":[],"payment":"","skipper":"","cancellation":""},"flags":[{"code":"MISSING_APA","message":"..."}],"notes":""}`;

export async function extractSupplier(
  supplierRaw: string,
  brief?: string,
): Promise<Extraction> {
  const userMsg = [
    brief ? `Broker brief / context: ${brief}` : "",
    "SUPPLIER EMAIL(S) — extract from this only:",
    "```",
    supplierRaw,
    "```",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await aiChat(SYSTEM_PROMPT, userMsg, { maxTokens: 4000, temperature: 0 });
  let parsed: Extraction;
  try {
    parsed = parseLooseJson(raw) as Extraction;
  } catch {
    throw new Error(`Extraction returned non-JSON: ${raw.slice(0, 400)}`);
  }
  if (!parsed.pricing) throw new Error("Extraction missing pricing block");
  if (!Array.isArray(parsed.flags)) parsed.flags = [];
  if (!Array.isArray(parsed.seasonal_rates)) parsed.seasonal_rates = [];
  if (!parsed.content || typeof parsed.content !== "object") {
    parsed.content = { highlights: [], accommodation: [], water_toys: [], tech_specs: [], crew_line: "" };
  }

  // The model sometimes returns numerics as strings ("40", "EUR 159,000").
  // Coerce the numeric pricing fields to real numbers so the review UI and
  // the deterministic compute step get clean values. This is NOT arithmetic
  // — it only parses the single extracted token, never combines numbers.
  const numericFields: (keyof ExtractedPricing)[] = [
    "charter_fee", "apa_pct", "apa_amount", "vat_pct", "vat_amount", "divide_by", "all_inclusive_total",
    "discount_pct", "list_price",
  ];
  for (const k of numericFields) {
    const f = parsed.pricing[k] as Field<number> | undefined;
    if (f) f.value = toNum(f.value);
  }
  enforceGrossCharterFee(parsed.pricing);
  for (const sr of parsed.seasonal_rates) sr.fee = toNum(sr.fee) ?? sr.fee;
  parsed.extras = normalizeExtras(parsed.extras);
  return ensureSeasonalFlag(parsed);
}

// Normalise the per-yacht extras block to the known shape (drop empties, trim,
// cap). Missing/malformed => an empty extras block (the template renders nothing
// for it; weekly/crewed unchanged). FACTUAL only — never fabricates entries.
function normalizeExtras(x: unknown): ExtractedYachtExtras {
  const o = (x && typeof x === "object") ? (x as Record<string, unknown>) : {};
  const pab = (Array.isArray(o.payable_at_base) ? o.payable_at_base : [])
    .map((p) => {
      const r = (p && typeof p === "object") ? (p as Record<string, unknown>) : {};
      return { label: (r.label ?? "").toString().trim(), amount: (r.amount ?? "").toString().trim() };
    })
    .filter((p) => p.label)
    .slice(0, 20);
  const dep = (o.security_deposit ?? "").toString().trim();
  const fob = (Array.isArray(o.free_onboard) ? o.free_onboard : [])
    .map((s) => (s ?? "").toString().trim())
    .filter(Boolean)
    .slice(0, 30);
  return { payable_at_base: pab, security_deposit: dep, free_onboard: fob };
}

// Deterministic pricing-consistency guard (NOT arithmetic — a single field copy).
// computePricing applies discount_pct to charter_fee: net = charter_fee × (1 − disc%).
// So charter_fee MUST be the GROSS / list rate the discount is taken off — never an
// already-discounted figure, or the discount is applied TWICE (supplier 6,000 −18%
// → client 4,920 would wrongly become 4,920 −18% = 4,034, even below the broker's
// cost). When BOTH a discount and a list/gross price are present, force
// charter_fee = list_price so the computed net lands on the supplier's stated
// post-discount client price. The math itself stays in computePricing.
function enforceGrossCharterFee(pricing?: ExtractedPricing | null): void {
  if (!pricing) return;
  const disc = pricing.discount_pct?.value;
  const list = pricing.list_price?.value;
  const fee = pricing.charter_fee;
  if (!fee || typeof disc !== "number" || disc <= 0 || disc >= 100) return;
  if (typeof list === "number" && list > 0) {
    fee.value = list;                       // exact gross taken straight from the email
    return;
  }
  // No list price captured, but the model returned a discount % AND the
  // (post-discount) client fee. Reconstruct the GROSS so computePricing applies
  // the discount exactly ONCE (net = gross × (1 − disc%)). e.g. fee 5,180 with
  // −30% → gross 7,400 → net 5,180. Guarantees no double-discount even when the
  // AI misses the list price.
  if (typeof fee.value === "number" && fee.value > 0) {
    fee.value = Math.round((fee.value / (1 - disc / 100)) * 100) / 100;
  }
}

// Parse a single numeric token (strip currency/commas/spaces). Returns null
// for empty/unparseable. Does NOT do arithmetic.
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Deterministic safety net: when 2+ seasonal rates were captured but no single
// charter fee was chosen, GUARANTEE the MULTIPLE_SEASONAL_RATES STOP flag. The
// model reliably extracts the seasonal rates into seasonal_rates[] but often
// forgets the flag, so the review card would show the rate chips without the
// STOP prompt telling the human to pick the rate for the dates. This is code,
// not AI - it always fires. (No math: it only adds a flag.)
function ensureSeasonalFlag(x: Extraction): Extraction {
  // Drop malformed flags (missing/empty code) the model sometimes emits, so the
  // review screen never shows a blank warning chip.
  if (Array.isArray(x.flags)) {
    x.flags = x.flags.filter((f) => f && typeof f.code === "string" && f.code.trim().length > 0);
  }
  const fee = x.pricing?.charter_fee?.value;
  const rates = Array.isArray(x.seasonal_rates) ? x.seasonal_rates : [];
  if (rates.length >= 2 && (fee === null || fee === undefined)) {
    if (!Array.isArray(x.flags)) x.flags = [];
    if (!x.flags.some((f) => f.code === "MULTIPLE_SEASONAL_RATES")) {
      x.flags.push({
        code: "MULTIPLE_SEASONAL_RATES",
        message: "Multiple seasonal rates were quoted. Pick the rate that matches the charter dates before generating.",
      });
    }
  }
  return x;
}

// =============================================================
// MULTI-YACHT (combined proposal) — one supplier email may offer several
// yachts. We extract EACH yacht as its own Extraction (own numbers + verbatim
// snippets + confidence + suggested_mode + per-yacht STOP flags). Still NO
// arithmetic; the same absolute rules apply per yacht. George reviews every
// yacht's numbers on its own card before Generate.
// =============================================================

const MULTI_SYSTEM = `You extract structured data from a raw yacht central-agency email (or several pasted emails) that offers ONE OR MORE yachts, so a broker (George Yachts) can build a combined client proposal. You are an EXTRACTOR, not a calculator.

ABSOLUTE RULES — breaking these causes a contract dispute:
1. Extract ONLY values that appear LITERALLY in the email. Never calculate, infer, convert, or fill in a "reasonable" number. If a value is not explicitly written, its "value" is null.
2. Do NO arithmetic of any kind (no APA from a percentage, no totals, no all-in). Code does that later, deterministically.
3. For every pricing field return "value" (the number exactly as written, currency symbols / spaces / thousands separators removed; e.g. "EUR 159,000" -> 159000), "confidence" ("high"/"medium"/"low"), and "snippet" (the EXACT verbatim substring it came from; "" if not found).

Treat EACH yacht the supplier offers as a SEPARATE object with its OWN numbers, snippets, confidence, suggested_mode and flags. Per yacht:
- charter_fee: the NET CLIENT rate for the period (the price the client pays, AFTER any discount, BEFORE commission). If a yacht has TWO+ seasonal rates, set its charter_fee.value=null, list them in that yacht's "seasonal_rates" (label+fee+snippet), add flag MULTIPLE_SEASONAL_RATES.
- discount_pct: if the supplier offers a discount off the list rate as a percentage (e.g. "-18%", "18% discount", "less 30%"), capture that number. If the email shows a LIST price AND a discounted/net price, set list_price = the list/gross figure and charter_fee = the DISCOUNTED client figure. Code computes the math; you only extract. (e.g. list 6,000, -18% => list_price 6000, discount_pct 18, charter_fee 4920 if the email already states 4,920; if only the % is given, set charter_fee=null with the list_price + discount_pct so code/human resolve it.)
- list_price: the list / gross rate BEFORE discount, when both are shown.
- commission_internal (INTERNAL ONLY, STRING): the supplier's "price to agency", "net to us", "price to <agency>", commission amount or commission % (the broker's margin), exactly as written. This is for the broker's eyes only and MUST NEVER appear in charter_fee, list_price, extras, content, notes, or any client-facing field. The client sees only the post-discount charter fee.
- apa_pct AND apa_amount: whichever stated; if neither, add MISSING_APA. vat_pct AND vat_amount: whichever stated; if neither, MISSING_VAT. If APA or VAT is given as a RANGE (e.g. "35-40%", "20% to 40%"), capture the HIGHER end with confidence "low" and the range text in the snippet - never leave null just because it is a range. NOTE: for BAREBOAT yachts VAT is INCLUDED in the price — do NOT raise MISSING_VAT and do NOT add a separate VAT-extra row.
- extras_text + flag PLUS_EXTRAS_NO_BREAKDOWN: only for a lump "plus extras / plus expenses" with NO APA/VAT breakdown.
- all_inclusive_total + "suggested_mode":"all_inclusive": if that yacht states ONE fully-inclusive figure ("all included", "fully inclusive", "all-in", Greek "ola mesa"). Then do NOT fill charter_fee/apa/vat for it and do NOT raise MISSING_APA. Otherwise suggested_mode is "breakdown" or "plus_extras".
- divide_by (+ DIVIDE_BY_UNCLEAR if short but no divisor), currency, NO_PRICE_FOUND if that yacht has no price.
- extras (PER-YACHT, FACTUAL, money-box only — NOT the last page; leave empty if not stated): {"payable_at_base":[{"label":"<verbatim, e.g. Charter Pack — end cleaning, linen, gas, outboard fuel, first/last night mooring>","amount":"<as written, e.g. EUR 250>"}],"security_deposit":"<verbatim, e.g. EUR 3,000 refundable, by card at base>","free_onboard":["<complimentary on-board item, e.g. 1 SUP>","Welcome Pack"]}. Bareboat emails list these under "Payable at base", "Security deposit", and free/complimentary items. For CREWED weekly yachts leave extras empty (the APA model covers them). CATEGORISATION (do NOT mix up): a big "Equipment:"/"On-Deck:"/"Galley:"/"Electrical:"/"Entertainment:"/"Sports Equipment:" list = the YACHT'S OWN gear/features → put notable ones in content.highlights (toys/tenders in water_toys); NEVER put equipment in payable_at_base. payable_at_base = ONLY items actually PAID at base with a real amount (e.g. Charter Pack EUR 250); an item marked "included in price"/"included"/EUR 0 is COMPLIMENTARY → free_onboard, not payable_at_base. IGNORE any "Total (Payable at base)" SUM line (capture line items only). "Skipper licence required" → suggested_terms.skipper, not extras.
- vessel_name, vessel_type, spec_line, dates.from/to, embarkation/disembarkation ports ("Athens to Mykonos" -> embarkation "Athens", disembarkation "Mykonos"; "Mykonos to Mykonos" -> both "Mykonos"; if no route stated, leave null), and content (highlights[], accommodation[][], water_toys[], tech_specs[][], crew_line) - FACTUAL, verbatim, NEVER invented; leave empty if not stated.

PROPOSAL-LEVEL (for the whole selection, OUTSIDE the yachts array):
- suggested_charter_type: auto-detect the product type from the email language — "bareboat" (the words "bareboat", security deposit + "payable at base" + no APA/crew gratuity), "daily" ("day charter", "per day"), "weekly" (crewed weekly with APA / crew gratuity / MYBA language), or "custom" if unclear. The broker confirms it.
- suggested_terms: {"included":[...],"not_included":[...],"payment":"...","skipper":"...","cancellation":"..."} from what the email states (empty where not stated). For bareboat note VAT as INCLUDED in the price, never as a separate extra. The broker edits/clears these.

CONFIDENTIALITY: never include the source agency/broker company name, person names, emails, phone numbers, or broker URLs anywhere. Strip them from every yacht. NEVER surface commission / price-to-agency to any client-facing field — it lives ONLY in each yacht's commission_internal.

OUTPUT: a SINGLE JSON object, no markdown fences, exactly:
{"yachts":[{"vessel_name":{"value":null,"confidence":"low","snippet":""},"vessel_type":{...},"spec_line":{...},"pricing":{"currency":{...},"charter_fee":{...},"apa_pct":{...},"apa_amount":{...},"vat_pct":{...},"vat_amount":{...},"extras_text":{...},"divide_by":{...},"all_inclusive_total":{...},"discount_pct":{...},"list_price":{...},"commission_internal":{"value":null,"confidence":"low","snippet":""}},"extras":{"payable_at_base":[],"security_deposit":"","free_onboard":[]},"seasonal_rates":[],"dates":{"from":{...},"to":{...}},"embarkation":{"value":null,"confidence":"low","snippet":""},"disembarkation":{"value":null,"confidence":"low","snippet":""},"content":{"highlights":[],"accommodation":[],"water_toys":[],"tech_specs":[],"crew_line":""},"suggested_mode":"breakdown","flags":[],"notes":""}],"suggested_charter_type":"weekly","suggested_terms":{"included":[],"not_included":[],"payment":"","skipper":"","cancellation":""}}
If only one yacht is offered, return an array with one element. NEVER do math.`;

// Numeric/array coercion + defaults for one extracted yacht. Mirrors the
// single-yacht tail of extractSupplier. Only parses single tokens (no math).
function coerceYacht(y: Extraction): Extraction {
  if (!y.pricing) y.pricing = {} as ExtractedPricing;
  if (!Array.isArray(y.flags)) y.flags = [];
  if (!Array.isArray(y.seasonal_rates)) y.seasonal_rates = [];
  if (!y.content || typeof y.content !== "object") {
    y.content = { highlights: [], accommodation: [], water_toys: [], tech_specs: [], crew_line: "" };
  }
  const numericFields: (keyof ExtractedPricing)[] = [
    "charter_fee", "apa_pct", "apa_amount", "vat_pct", "vat_amount", "divide_by", "all_inclusive_total",
    "discount_pct", "list_price",
  ];
  for (const k of numericFields) {
    const f = y.pricing[k] as Field<number> | undefined;
    if (f) f.value = toNum(f.value);
  }
  enforceGrossCharterFee(y.pricing);
  for (const sr of y.seasonal_rates) sr.fee = toNum(sr.fee) ?? sr.fee;
  y.extras = normalizeExtras(y.extras);
  return ensureSeasonalFlag(y);
}

// Validate the auto-detected charter type to the 4 known values; anything else
// (or absent) is dropped so the panel keeps its own default.
function coerceCharterType(v: unknown): SuggestedCharterType | undefined {
  const s = (v ?? "").toString().trim().toLowerCase();
  return s === "weekly" || s === "bareboat" || s === "daily" || s === "custom" ? (s as SuggestedCharterType) : undefined;
}

// Normalise the proposal-level suggested terms (drop empties). undefined when
// nothing usable, so the panel's TermsEditor seeds empty (owner opts in).
function coerceSuggestedTerms(v: unknown): SuggestedTerms | undefined {
  const o = (v && typeof v === "object") ? (v as Record<string, unknown>) : {};
  const arr = (x: unknown) => (Array.isArray(x) ? x.map((s) => (s ?? "").toString().trim()).filter(Boolean).slice(0, 40) : []);
  const str = (x: unknown) => (x ?? "").toString().trim();
  const out: SuggestedTerms = {};
  const inc = arr(o.included); if (inc.length) out.included = inc;
  const ninc = arr(o.not_included); if (ninc.length) out.not_included = ninc;
  const pay = str(o.payment); if (pay) out.payment = pay;
  const skip = str(o.skipper); if (skip) out.skipper = skip;
  const can = str(o.cancellation); if (can) out.cancellation = can;
  return Object.keys(out).length ? out : undefined;
}

// =============================================================
// DETERMINISTIC DUPLICATE-MERGE ("THE DOUBLE") — NOT AI.
// A supplier often quotes the SAME yacht for TWO durations (e.g. 5 nights AND
// 7 nights) with different dates + fees. We want ONE card per yacht showing
// BOTH options. After extractSupplierYachts parses the array, we group yachts
// by NORMALISED vessel name; for any name with 2+ entries we keep the FIRST as
// the base (its specs / photo / features) and turn EACH entry's
// (dates + post-discount client fee + discount/list) into a period_options
// entry on that base, then remove the now-merged duplicates. A yacht quoted
// ONCE is untouched (no period_options). Pure code, fully testable; no model.
// =============================================================

// Normalise a vessel name for grouping: lowercase, strip M/Y, MOTOR YACHT, S/Y,
// SAILING YACHT prefixes, drop punctuation, collapse spaces. "" when no name.
function normalizeVesselName(raw?: string | null): string {
  let s = (raw ?? "").toString().toLowerCase().trim();
  if (!s) return "";
  // Strip leading vessel-type prefixes (with or without slashes / spaces).
  s = s.replace(/^(m\/?y|s\/?y|motor\s+yacht|sailing\s+yacht|catamaran|motor\s+catamaran|sailing\s+catamaran)\b[\s.:-]*/i, "");
  // Drop non-alphanumerics (keep spaces), collapse whitespace.
  s = s.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

// Parse a date token (ISO "2026-08-31" or human "31 Aug 2026" / "31 August") to
// a UTC Date for night-count + display. null when unparseable.
function parseDateToken(input?: string | null): Date | null {
  const s = (input ?? "").toString().trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const human = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?(?:\s+(\d{4}))?/);
  if (human) {
    const mi = MONTH_IDX[human[2].toLowerCase()];
    if (mi !== undefined) {
      const year = human[3] ? Number(human[3]) : new Date().getUTCFullYear();
      const d = new Date(Date.UTC(year, mi, Number(human[1])));
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

const MONTHS_3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_IDX: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  const long = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  MONTHS_3.forEach((s, i) => { m[s.toLowerCase()] = i; });
  long.forEach((s, i) => { m[s] = i; });
  m["sept"] = 8;
  return m;
})();

// Nights between two dates (>=1) or null when either is unparseable.
function nightsBetween(from?: string | null, to?: string | null): number | null {
  const a = parseDateToken(from), b = parseDateToken(to);
  if (!a || !b) return null;
  const n = Math.round((b.getTime() - a.getTime()) / 86400000);
  return n > 0 ? n : null;
}

// Display one date as "31 Aug 2026" (year dropped only when absent in source).
function fmtDay(d: Date, withYear: boolean): string {
  const day = String(d.getUTCDate());
  const mon = MONTHS_3[d.getUTCMonth()];
  return withYear ? `${day} ${mon} ${d.getUTCFullYear()}` : `${day} ${mon}`;
}

// "31 Aug – 5 Sep 2026" — share the year on the right; if same month, keep both
// month names (clearer for clients). Falls back to the raw tokens when unparseable.
function fmtDateRange(from?: string | null, to?: string | null): string {
  const a = parseDateToken(from), b = parseDateToken(to);
  if (a && b) {
    const left = `${String(a.getUTCDate())} ${MONTHS_3[a.getUTCMonth()]}`;
    const right = fmtDay(b, true);
    return `${left} – ${right}`;
  }
  // Unparseable: present whatever literal tokens exist.
  const fa = (from ?? "").toString().trim();
  const fb = (to ?? "").toString().trim();
  if (fa && fb) return `${fa} – ${fb}`;
  return fa || fb || "";
}

// The CLIENT (post-discount) fee for one extracted yacht entry, as a money
// string. Mirrors computePricing's discount math (net = gross × (1 − disc%)),
// using the gross that enforceGrossCharterFee already normalised charter_fee to.
// Returns "" when no fee is present (the option still renders off its label).
function clientFeeDisp(p: ExtractedPricing): string {
  const fee = p?.charter_fee?.value;
  if (typeof fee !== "number" || !(fee > 0)) {
    const allIn = p?.all_inclusive_total?.value;
    return typeof allIn === "number" && allIn > 0 ? fmtEur(allIn) : "";
  }
  const disc = p?.discount_pct?.value;
  const net = (typeof disc === "number" && disc > 0 && disc < 100) ? fee * (1 - disc / 100) : fee;
  return fmtEur(net);
}

// The muted "8% offer, from € 24,000" sub-line when a discount applies and a
// list/gross figure is known. "" when no discount. Uses the gross charter_fee
// (enforceGrossCharterFee set it to the list) as the "from" anchor.
function periodNote(p: ExtractedPricing): string {
  const disc = p?.discount_pct?.value;
  if (typeof disc !== "number" || !(disc > 0) || disc >= 100) return "";
  const gross = (typeof p?.list_price?.value === "number" && p.list_price.value > 0)
    ? p.list_price.value
    : (typeof p?.charter_fee?.value === "number" ? p.charter_fee.value : null);
  const pctTxt = Math.abs(disc - Math.trunc(disc)) < 1e-9 ? `${Math.trunc(disc)}%` : `${disc}%`;
  return gross ? `${pctTxt} offer, from ${fmtEur(gross)}` : `${pctTxt} offer`;
}

// Build ONE period option from a yacht entry. label = night count when both
// dates parse ("5 nights"); else "Option N". dates = formatted range. fee =
// post-discount client fee. note = discount line (if any). Robust: an entry
// with unparseable dates still yields an option (label/fee preserved).
function periodOptionFromEntry(y: Extraction, ordinal: number): PeriodOption {
  const from = y.dates?.from?.value;
  const to = y.dates?.to?.value;
  const nights = nightsBetween(from, to);
  const label = nights !== null ? `${nights} night${nights === 1 ? "" : "s"}` : `Option ${ordinal}`;
  const dates = fmtDateRange(from, to);
  const fee_disp = clientFeeDisp(y.pricing);
  const note = periodNote(y.pricing);
  const opt: PeriodOption = { label, fee_disp };
  if (dates) opt.dates = dates;
  if (note) opt.note = note;
  return opt;
}

// Group the extracted yachts by normalised name; merge any 2+ same-name entries
// into the FIRST as the base, carrying each entry's duration into period_options
// and dropping the merged duplicates. Yachts with a blank/unique name pass
// through untouched (no period_options). Preserves the first-seen order.
export function mergeDuplicateYachts(yachts: Extraction[]): Extraction[] {
  const order: string[] = [];
  const groups = new Map<string, Extraction[]>();
  for (const y of yachts) {
    const key = normalizeVesselName(y.vessel_name?.value);
    // Yachts with no resolvable name can't be safely grouped — keep each on its
    // own bucket (unique key) so they are never merged together.
    const bucket = key || `__unnamed_${order.length}_${groups.size}`;
    if (!groups.has(bucket)) { groups.set(bucket, []); order.push(bucket); }
    groups.get(bucket)!.push(y);
  }
  const out: Extraction[] = [];
  for (const bucket of order) {
    const entries = groups.get(bucket)!;
    if (entries.length < 2) { out.push(entries[0]); continue; }
    // MERGE: first entry is the base (its specs / content / type survive).
    const base = entries[0];
    base.period_options = entries.map((y, i) => periodOptionFromEntry(y, i + 1));
    // The base's single charter_fee is now superseded by the period table — the
    // money box renders periods INSTEAD. (We leave the pricing block intact for
    // the broker's reference; the template ignores it when period_options exist.)
    out.push(base);
  }
  return out;
}

export async function extractSupplierYachts(
  supplierRaw: string,
  brief?: string,
): Promise<CombinedExtraction> {
  const userMsg = [
    brief ? `Broker brief / context: ${brief}` : "",
    "SUPPLIER EMAIL(S) — extract every yacht from this only:",
    "```",
    supplierRaw,
    "```",
  ]
    .filter(Boolean)
    .join("\n");

  // Generous token budget: a thinking model emitting N yachts of structured
  // JSON (each with pricing + content arrays) truncates if starved. 8000 was
  // not enough for 2+ yachts with long spec/content; 24000 leaves headroom
  // (you only pay for tokens actually generated).
  const raw = await aiChat(MULTI_SYSTEM, userMsg, { maxTokens: 24000, temperature: 0 });
  let parsed: { yachts?: unknown; suggested_charter_type?: unknown; suggested_terms?: unknown };
  try {
    parsed = parseLooseJson(raw) as { yachts?: unknown; suggested_charter_type?: unknown; suggested_terms?: unknown };
  } catch {
    const looksCut = !raw.trimEnd().endsWith("}");
    throw new Error(
      looksCut
        ? "Multi-yacht extraction was cut off before the JSON finished (supplier text too long for one pass). Press Extract again; if it repeats, split the two offers and extract them one at a time."
        : `Multi-yacht extraction returned non-JSON. Start: ${raw.slice(0, 200)} | End: ${raw.slice(-200)}`,
    );
  }
  const arr = Array.isArray(parsed?.yachts) ? parsed.yachts : [];
  if (!arr.length) throw new Error("Multi-yacht extraction found no yachts in the supplier email.");
  const coerced = arr.map((y) => coerceYacht(y as Extraction));
  // DETERMINISTIC post-process (NOT AI): collapse the SAME yacht quoted for 2+
  // durations into ONE base yacht carrying both as period_options ("the double").
  const yachts = mergeDuplicateYachts(coerced);
  const out: CombinedExtraction = { yachts };
  const sct = coerceCharterType(parsed?.suggested_charter_type);
  if (sct) out.suggested_charter_type = sct;
  const st = coerceSuggestedTerms(parsed?.suggested_terms);
  if (st) out.suggested_terms = st;
  return out;
}
