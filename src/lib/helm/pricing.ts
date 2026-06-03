// src/lib/helm/pricing.ts
// =============================================================
// The Helm — pricing engine. ALL money math lives here so the
// numbers are always correct. The AI never computes (see extract.ts).
//
// Three modes:
//   breakdown      — charter_fee + APA(%/amount) + VAT(%/amount); all_in = sum
//   plus_extras    — lump fee "plus extras"; no all_in
//   all_inclusive  — ONE figure with APA+VAT+extras inside; all_in = total
// Per-person (4 and 6 guests) is derived from all_in when an all_in exists
// (breakdown + all_inclusive); plus_extras has no total so no per-person.
// =============================================================

export type PricingMode = "breakdown" | "plus_extras" | "all_inclusive";

export type PricingInput = {
  currency?: string;
  /** Explicit mode. If absent it is inferred:
   *  all_inclusive_total → all_inclusive; extras_text → plus_extras; else breakdown. */
  mode?: PricingMode;
  charter_fee?: number | null;
  apa_pct?: number | null;
  apa_amount?: number | null;
  vat_pct?: number | null;
  vat_amount?: number | null;
  /** Set ONLY for the "plus extras" case (no APA/VAT breakdown). */
  extras_text?: string | null;
  /** Set ONLY for the "all-inclusive" case (one figure, APA+VAT+extras inside). */
  all_inclusive_total?: number | null;
  /** Owner discount applied to the NET charter fee, BEFORE APA/VAT (e.g. 5 = -5%). */
  discount_pct?: number | null;
  /** Flat relocation / delivery fee added to the total (broker enters the final amount). */
  relocation_fee?: number | null;
  /** Broker's final rounded all-in total; overrides the computed total when set (> 0). */
  all_in_override?: number | null;
  details?: [string, string][];
};

export type ComputedPricing = {
  mode: PricingMode;
  extras_mode: boolean; // back-compat: true when mode === "plus_extras"
  all_inclusive: boolean; // true when mode === "all_inclusive"
  /** Bold owner-discount note shown above the cost rows (null when no discount). */
  discount_note: string | null;
  rows: [string, string][];
  all_in: string | null;
  charter_fee_disp: string;
  headline: string;
  deposit: string | null;
  balance: string | null;
  /** All-in cost per guest at 4 and 6 guests (null when no all_in total). */
  per_person_4: string | null;
  per_person_6: string | null;
};

// Money formatter — "€ 159,000" (€ + narrow no-break space + en-US separators).
export function fmtEur(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "";
  const num = typeof n === "number" ? n : Number(n);
  if (Number.isNaN(num)) return String(n);
  let s: string;
  if (Math.abs(num - Math.round(num)) < 0.005) {
    s = Math.round(num).toLocaleString("en-US");
  } else {
    s = num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return "€ " + s; // € + narrow no-break space, as in build_proposal.py
}

// =============================================================
// SPLIT-SEASON PRORATION (broker method) — when a charter spans two seasons,
// each season's WEEKLY rate becomes a DAILY rate (weekly / 7, rounded to a
// clean figure) and the fee is the sum over the charter days in each season.
// Example: June 19,000/wk -> 2,700/day x 5 + July 21,000/wk -> 3,000/day x 2
// = 19,500. Used only when the supplier quotes seasonal rates AND the dates
// straddle a season boundary; a single fixed rate skips this entirely.
// =============================================================

// Suggested daily rate from a weekly rate: weekly / 7 rounded to the nearest
// 100 (the clean figure a broker uses, e.g. 19,000/7 = 2,714 -> 2,700). The
// review screen lets the broker adjust it.
export function suggestDailyRate(weekly: number | string): number {
  const w = Number(weekly);
  if (!Number.isFinite(w) || w <= 0) return 0;
  return Math.round(w / 7 / 100) * 100;
}

// Sum of (daily rate x days) across the season segments. Pure arithmetic; the
// broker supplies the per-season daily rate + day count on the review screen.
export function prorateSeasonsTotal(segments: { daily: number | string; days: number | string }[]): number {
  return (segments || []).reduce((sum, s) => {
    const d = Number(s?.daily), n = Number(s?.days);
    return sum + (Number.isFinite(d) ? d : 0) * (Number.isFinite(n) ? n : 0);
  }, 0);
}

// Numeric all-in (NOT formatted) — used to sort a combined shortlist
// cheapest -> priciest. Same math as computePricing, returns the raw number.
// null when there is no total (plus_extras, or a missing required figure).
export function allInNumber(p?: PricingInput | null): number | null {
  if (!p) return null;
  const mode = resolveMode(p);
  if (mode === "all_inclusive") {
    const t = p.all_inclusive_total;
    return t === null || t === undefined ? null : Number(t);
  }
  if (mode === "plus_extras") return null; // lump price, no total
  const fee0 = p.charter_fee;
  if (fee0 === null || fee0 === undefined) return null;
  const grossFee = Number(fee0);
  const disc = (p.discount_pct !== null && p.discount_pct !== undefined && Number(p.discount_pct) > 0)
    ? Number(p.discount_pct) : null;
  const netFee = disc !== null ? grossFee * (1 - disc / 100) : grossFee;
  let apaAmt: number | null = p.apa_amount ?? null;
  if (apaAmt === null && p.apa_pct !== null && p.apa_pct !== undefined) apaAmt = (netFee * Number(p.apa_pct)) / 100;
  let vatAmt: number | null = p.vat_amount ?? null;
  if (vatAmt === null && p.vat_pct !== null && p.vat_pct !== undefined) vatAmt = (netFee * Number(p.vat_pct)) / 100;
  const reloc = (p.relocation_fee !== null && p.relocation_fee !== undefined && Number(p.relocation_fee) > 0)
    ? Number(p.relocation_fee) : 0;
  const computed = netFee + (apaAmt ?? 0) + (vatAmt ?? 0) + reloc;
  const override = (p.all_in_override !== null && p.all_in_override !== undefined && Number(p.all_in_override) > 0)
    ? Number(p.all_in_override) : null;
  return override ?? computed;
}

// Percent label — "40%" / "6.5%".
function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const num = Number(v);
  return Math.abs(num - Math.trunc(num)) < 1e-9 ? `${Math.trunc(num)}%` : `${num}%`;
}

function resolveMode(p: PricingInput): PricingMode {
  if (p.mode) return p.mode;
  if (p.all_inclusive_total !== null && p.all_inclusive_total !== undefined) return "all_inclusive";
  if (p.extras_text) return "plus_extras";
  return "breakdown";
}

export function computePricing(p?: PricingInput | null): ComputedPricing {
  const out: ComputedPricing = {
    mode: "breakdown",
    extras_mode: false,
    all_inclusive: false,
    discount_note: null,
    rows: [],
    all_in: null,
    charter_fee_disp: "",
    headline: "",
    deposit: null,
    balance: null,
    per_person_4: null,
    per_person_6: null,
  };
  if (!p) return out;

  const mode = resolveMode(p);
  out.mode = mode;
  out.extras_mode = mode === "plus_extras";
  out.all_inclusive = mode === "all_inclusive";

  // ---- ALL-INCLUSIVE: one figure, everything inside. No APA/VAT computed.
  if (mode === "all_inclusive") {
    const total = p.all_inclusive_total;
    if (total === null || total === undefined) return out;
    const t = Number(total);
    out.charter_fee_disp = fmtEur(t);
    out.headline = fmtEur(t);
    out.all_in = fmtEur(t);
    out.deposit = fmtEur(t * 0.5);
    out.balance = fmtEur(t * 0.5);
    out.per_person_4 = fmtEur(t / 4);
    out.per_person_6 = fmtEur(t / 6);
    return out;
  }

  // ---- PLUS EXTRAS: lump price, no breakdown, no total → no per-person.
  if (mode === "plus_extras") {
    const fee0 = p.charter_fee;
    const extrasText = p.extras_text || "plus extras";
    if (fee0 !== null && fee0 !== undefined) {
      out.charter_fee_disp = fmtEur(fee0);
      out.headline = `${fmtEur(fee0)} ${extrasText}`.trim();
    } else {
      out.headline = extrasText;
    }
    return out;
  }

  // ---- BREAKDOWN: net fee (+ optional owner discount) + APA + VAT (+ optional
  // relocation). APA/VAT are computed on the DISCOUNTED net. The broker may
  // override any figure (apa_amount / vat_amount / all_in_override) for the
  // small "to look nice" rounding. With NO discount / relocation / override this
  // is byte-for-byte the previous behaviour. Same engine for direct-client and
  // travel-agent — request type never touches the numbers.
  const fee0 = p.charter_fee;
  if (fee0 === null || fee0 === undefined) return out;
  const grossFee = Number(fee0);
  out.charter_fee_disp = fmtEur(grossFee);
  out.headline = fmtEur(grossFee);

  // Owner discount on the NET charter fee, before APA/VAT.
  const disc = (p.discount_pct !== null && p.discount_pct !== undefined && Number(p.discount_pct) > 0)
    ? Number(p.discount_pct) : null;
  const netFee = disc !== null ? grossFee * (1 - disc / 100) : grossFee;
  if (disc !== null) {
    out.discount_note = `The Owner is pleased to offer a ${pct(disc)} discount.`;
    out.rows.push([`Net charter fee after ${pct(disc)} discount`, fmtEur(netFee)]);
  }

  let apaAmt: number | null = p.apa_amount ?? null;
  const apaPct = p.apa_pct ?? null;
  if (apaAmt === null && apaPct !== null) apaAmt = (netFee * Number(apaPct)) / 100;
  if (apaAmt !== null) {
    const label = apaPct !== null ? `APA (${pct(apaPct)})` : "APA";
    out.rows.push([label, fmtEur(apaAmt)]);
  }

  let vatAmt: number | null = p.vat_amount ?? null;
  const vatPct = p.vat_pct ?? null;
  if (vatAmt === null && vatPct !== null) vatAmt = (netFee * Number(vatPct)) / 100;
  if (vatAmt !== null) {
    const label = vatPct !== null ? `VAT (${pct(vatPct)})` : "VAT";
    out.rows.push([label, fmtEur(vatAmt)]);
  }

  // Flat relocation / delivery fee (broker enters the final amount).
  const reloc = (p.relocation_fee !== null && p.relocation_fee !== undefined && Number(p.relocation_fee) > 0)
    ? Number(p.relocation_fee) : null;
  if (reloc !== null) out.rows.push(["Relocation", fmtEur(reloc)]);

  const computedAllIn = netFee + (apaAmt ?? 0) + (vatAmt ?? 0) + (reloc ?? 0);
  const override = (p.all_in_override !== null && p.all_in_override !== undefined && Number(p.all_in_override) > 0)
    ? Number(p.all_in_override) : null;
  const allIn = override ?? computedAllIn;
  out.all_in = fmtEur(allIn);
  out.deposit = fmtEur(netFee * 0.5);
  out.balance = fmtEur(allIn - netFee * 0.5);
  out.per_person_4 = fmtEur(allIn / 4);
  out.per_person_6 = fmtEur(allIn / 6);
  return out;
}
