// src/lib/helm/pricing.ts
// =============================================================
// The Helm — charter pricing engine. 1:1 port of compute_pricing()
// from render-kit/scripts/build_proposal.py. ALL money math lives
// here so the numbers are always correct (a wrong figure becomes a
// contract dispute — see render-kit/references/pricing-engine.md).
//
// The caller supplies only charter_fee + apa_pct/apa_amount +
// vat_pct/vat_amount (or extras_text). This computes APA, VAT,
// all-in, and the MYBA 50/50 deposit/balance.
// =============================================================

export type PricingInput = {
  currency?: string;
  charter_fee?: number | null;
  apa_pct?: number | null;
  apa_amount?: number | null;
  vat_pct?: number | null;
  vat_amount?: number | null;
  /** Set ONLY for the "plus extras" case (no APA/VAT breakdown). */
  extras_text?: string | null;
  /** [label, value] rows shown under "Charter Details". */
  details?: [string, string][];
};

export type ComputedPricing = {
  extras_mode: boolean;
  rows: [string, string][];
  all_in: string | null;
  charter_fee_disp: string;
  headline: string;
  deposit: string | null;
  balance: string | null;
};

// Money formatter — "€ 159,000" (€ + narrow no-break space +
// en-US thousands separators). Mirrors fmt_eur() in build_proposal.py.
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
  return "€ " + s;
}

// Percent label — "40%" / "6.5%". Mirrors _pct() in the Python.
function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const num = Number(v);
  return Math.abs(num - Math.trunc(num)) < 1e-9 ? `${Math.trunc(num)}%` : `${num}%`;
}

export function computePricing(p?: PricingInput | null): ComputedPricing {
  const out: ComputedPricing = {
    extras_mode: false,
    rows: [],
    all_in: null,
    charter_fee_disp: "",
    headline: "",
    deposit: null,
    balance: null,
  };
  if (!p) return out;

  const extrasText = p.extras_text;
  const fee0 = p.charter_fee;

  // ---- "plus extras" mode (supplier gave a lump price, no breakdown)
  if (extrasText) {
    out.extras_mode = true;
    if (fee0 !== null && fee0 !== undefined) {
      out.charter_fee_disp = fmtEur(fee0);
      out.headline = `${fmtEur(fee0)} ${extrasText}`.trim();
    } else {
      out.headline = extrasText;
    }
    return out;
  }

  if (fee0 === null || fee0 === undefined) return out;
  const fee = Number(fee0);
  out.charter_fee_disp = fmtEur(fee);
  out.headline = fmtEur(fee);

  // ---- APA
  let apaAmt: number | null = p.apa_amount ?? null;
  const apaPct = p.apa_pct ?? null;
  if (apaAmt === null && apaPct !== null) apaAmt = (fee * Number(apaPct)) / 100;
  if (apaAmt !== null) {
    const label = apaPct !== null ? `APA (${pct(apaPct)})` : "APA";
    out.rows.push([label, fmtEur(apaAmt)]);
  }

  // ---- VAT
  let vatAmt: number | null = p.vat_amount ?? null;
  const vatPct = p.vat_pct ?? null;
  if (vatAmt === null && vatPct !== null) vatAmt = (fee * Number(vatPct)) / 100;
  if (vatAmt !== null) {
    const label = vatPct !== null ? `VAT (${pct(vatPct)})` : "VAT";
    out.rows.push([label, fmtEur(vatAmt)]);
  }

  // ---- all-in + MYBA 50/50 deposit/balance
  const allIn = fee + (apaAmt ?? 0) + (vatAmt ?? 0);
  out.all_in = fmtEur(allIn);
  out.deposit = fmtEur(fee * 0.5);
  out.balance = fmtEur(fee * 0.5 + (apaAmt ?? 0) + (vatAmt ?? 0));
  return out;
}
