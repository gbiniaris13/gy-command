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
  details?: [string, string][];
};

export type ComputedPricing = {
  mode: PricingMode;
  extras_mode: boolean; // back-compat: true when mode === "plus_extras"
  all_inclusive: boolean; // true when mode === "all_inclusive"
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

  // ---- BREAKDOWN: fee + APA + VAT (unchanged) + per-person on all-in.
  const fee0 = p.charter_fee;
  if (fee0 === null || fee0 === undefined) return out;
  const fee = Number(fee0);
  out.charter_fee_disp = fmtEur(fee);
  out.headline = fmtEur(fee);

  let apaAmt: number | null = p.apa_amount ?? null;
  const apaPct = p.apa_pct ?? null;
  if (apaAmt === null && apaPct !== null) apaAmt = (fee * Number(apaPct)) / 100;
  if (apaAmt !== null) {
    const label = apaPct !== null ? `APA (${pct(apaPct)})` : "APA";
    out.rows.push([label, fmtEur(apaAmt)]);
  }

  let vatAmt: number | null = p.vat_amount ?? null;
  const vatPct = p.vat_pct ?? null;
  if (vatAmt === null && vatPct !== null) vatAmt = (fee * Number(vatPct)) / 100;
  if (vatAmt !== null) {
    const label = vatPct !== null ? `VAT (${pct(vatPct)})` : "VAT";
    out.rows.push([label, fmtEur(vatAmt)]);
  }

  const allIn = fee + (apaAmt ?? 0) + (vatAmt ?? 0);
  out.all_in = fmtEur(allIn);
  out.deposit = fmtEur(fee * 0.5);
  out.balance = fmtEur(fee * 0.5 + (apaAmt ?? 0) + (vatAmt ?? 0));
  out.per_person_4 = fmtEur(allIn / 4);
  out.per_person_6 = fmtEur(allIn / 6);
  return out;
}
