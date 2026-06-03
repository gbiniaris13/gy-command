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

export type Extraction = {
  vessel_name: Field<string>;
  vessel_type: Field<string>;
  spec_line: Field<string>;
  pricing: ExtractedPricing;
  seasonal_rates: SeasonalRate[];
  dates: { from: Field<string>; to: Field<string> };
  content: ExtractedContent;
  /** AI's suggested pricing mode; George can override on the review screen. */
  suggested_mode?: "breakdown" | "plus_extras" | "all_inclusive";
  flags: ExtractionFlag[];
  notes: string;
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
- extras_text: set (e.g. "plus extras", "plus expenses") ONLY when the supplier gives a lump price with NO APA/VAT breakdown; also add flag PLUS_EXTRAS_NO_BREAKDOWN.
- all_inclusive_total: if the supplier states ONE fully-inclusive figure (e.g. "all included", "fully inclusive", "all-in", Greek "όλα μέσα"), capture that single number here and set "suggested_mode":"all_inclusive". In that case do NOT fill charter_fee/apa/vat, and do NOT raise MISSING_APA (there is no separate APA). Otherwise set suggested_mode to "breakdown" (normal fee+APA+VAT) or "plus_extras" (lump + extras).
- divide_by: if the supplier says to divide the weekly rate by a number for a short charter (e.g. "kindly divide by 6"), capture that N. If the request is clearly short but NO divisor is stated, set value null and add flag DIVIDE_BY_UNCLEAR.
- currency: the currency code if stated (e.g. "EUR").
- If no price at all is found, add flag NO_PRICE_FOUND.

OTHER FIELDS (factual, verbatim where possible, no invention):
- vessel_name, vessel_type (e.g. "MOTOR YACHT", "SAILING CATAMARAN"), spec_line (short dot-separated: length/builder/year/refit).
- dates.from / dates.to: the charter window if stated (YYYY-MM-DD if derivable verbatim, else the literal text).
- content (FACTUAL, verbatim, NEVER invented; leave empty if not stated): highlights[] (selling points the supplier listed), accommodation[] (cabin -> description pairs), water_toys[] (toys/tenders listed), tech_specs[] (label -> value pairs: builder/length/beam/guests/cabins/crew/speed...), crew_line (one sentence about the crew if stated). If the supplier did not state something, leave it out - never fill it in.

CONFIDENTIALITY: never include the source agency/broker company name, person names, emails, phone numbers, or broker URLs ANYWHERE in your output. Strip them.

OUTPUT: a SINGLE JSON object, no markdown fences, exactly this shape:
{"vessel_name":{"value":null,"confidence":"low","snippet":""},"vessel_type":{...},"spec_line":{...},"pricing":{"currency":{...},"charter_fee":{...},"apa_pct":{...},"apa_amount":{...},"vat_pct":{...},"vat_amount":{...},"extras_text":{...},"divide_by":{...},"all_inclusive_total":{...}},"seasonal_rates":[],"dates":{"from":{...},"to":{...}},"content":{"highlights":[],"accommodation":[],"water_toys":[],"tech_specs":[],"crew_line":""},"suggested_mode":"breakdown","flags":[{"code":"MISSING_APA","message":"..."}],"notes":""}`;

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
  ];
  for (const k of numericFields) {
    const f = parsed.pricing[k] as Field<number> | undefined;
    if (f) f.value = toNum(f.value);
  }
  for (const sr of parsed.seasonal_rates) sr.fee = toNum(sr.fee) ?? sr.fee;
  return parsed;
}

// Parse a single numeric token (strip currency/commas/spaces). Returns null
// for empty/unparseable. Does NOT do arithmetic.
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
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
- charter_fee: the NET rate for the period. If a yacht has TWO+ seasonal rates, set its charter_fee.value=null, list them in that yacht's "seasonal_rates" (label+fee+snippet), add flag MULTIPLE_SEASONAL_RATES.
- apa_pct AND apa_amount: whichever stated; if neither, add MISSING_APA. vat_pct AND vat_amount: whichever stated; if neither, MISSING_VAT.
- extras_text + flag PLUS_EXTRAS_NO_BREAKDOWN: only for a lump "plus extras / plus expenses" with NO APA/VAT breakdown.
- all_inclusive_total + "suggested_mode":"all_inclusive": if that yacht states ONE fully-inclusive figure ("all included", "fully inclusive", "all-in", Greek "ola mesa"). Then do NOT fill charter_fee/apa/vat for it and do NOT raise MISSING_APA. Otherwise suggested_mode is "breakdown" or "plus_extras".
- divide_by (+ DIVIDE_BY_UNCLEAR if short but no divisor), currency, NO_PRICE_FOUND if that yacht has no price.
- vessel_name, vessel_type, spec_line, dates.from/to, and content (highlights[], accommodation[][], water_toys[], tech_specs[][], crew_line) - FACTUAL, verbatim, NEVER invented; leave empty if not stated.

CONFIDENTIALITY: never include the source agency/broker company name, person names, emails, phone numbers, or broker URLs anywhere. Strip them from every yacht.

OUTPUT: a SINGLE JSON object, no markdown fences, exactly:
{"yachts":[{"vessel_name":{"value":null,"confidence":"low","snippet":""},"vessel_type":{...},"spec_line":{...},"pricing":{"currency":{...},"charter_fee":{...},"apa_pct":{...},"apa_amount":{...},"vat_pct":{...},"vat_amount":{...},"extras_text":{...},"divide_by":{...},"all_inclusive_total":{...}},"seasonal_rates":[],"dates":{"from":{...},"to":{...}},"content":{"highlights":[],"accommodation":[],"water_toys":[],"tech_specs":[],"crew_line":""},"suggested_mode":"breakdown","flags":[],"notes":""}]}
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
  ];
  for (const k of numericFields) {
    const f = y.pricing[k] as Field<number> | undefined;
    if (f) f.value = toNum(f.value);
  }
  for (const sr of y.seasonal_rates) sr.fee = toNum(sr.fee) ?? sr.fee;
  return y;
}

export async function extractSupplierYachts(
  supplierRaw: string,
  brief?: string,
): Promise<Extraction[]> {
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
  let parsed: { yachts?: unknown };
  try {
    parsed = parseLooseJson(raw) as { yachts?: unknown };
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
  return arr.map((y) => coerceYacht(y as Extraction));
}
