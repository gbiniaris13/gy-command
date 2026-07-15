"use client";

// The Helm — COMBINED multi-yacht review + generate. One card per yacht, each
// with its OWN pricing mode, numbers (beside their verbatim supplier snippet +
// confidence), STOP flags, and photo. Generate is DISABLED until EVERY yacht
// has its required figure set + all its STOP flags resolved, and the client
// surname is present. The route computes each yacht in code, sorts the
// shortlist cheapest -> priciest by all-in, and assembles ONE combined PDF.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import SeasonProration from "./SeasonProration";
import PricingExtras from "./PricingExtras";
import TermsEditor, { type TermsState, EMPTY_TERMS, termsStateFromObject, termsObjectFromState } from "./TermsEditor";
import type { PricingInput } from "@/lib/helm/pricing";

// Never crash on a non-JSON response (e.g. Vercel's plain-text 413 "Request
// Entity Too Large"). Returns a friendly { error } message instead of throwing
// "Unexpected token 'R'…" out of res.json().
async function readJsonSafe(r: Response): Promise<any> {
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { return { error: r.status === 413 ? "That file is too large to upload through the server. (Large PDFs now upload directly — if you still see this, the file may exceed 45MB.)" : (text.slice(0, 200) || `Upload failed (HTTP ${r.status})`) }; }
}

type Confidence = "high" | "medium" | "low";
type Field<T> = { value: T | null; confidence: Confidence; snippet: string };
// PER-YACHT bareboat extras as returned by the extractor (money-box only).
type YachtExtras = {
  payable_at_base?: { label?: string; amount?: string }[];
  security_deposit?: string;
  free_onboard?: string[];
};
type YachtExtraction = {
  vessel_name: Field<string>;
  vessel_type: Field<string>;
  spec_line: Field<string>;
  pricing: Record<string, Field<number | string>>;
  extras?: YachtExtras;
  seasonal_rates: { label: string; fee: number; snippet: string }[];
  dates?: { from?: Field<string>; to?: Field<string> };
  embarkation?: Field<string>;
  disembarkation?: Field<string>;
  content?: Record<string, unknown>;
  suggested_mode?: "breakdown" | "plus_extras" | "all_inclusive";
  flags: { code: string; message: string }[];
  /** "THE DOUBLE": set by the deterministic merge when the supplier quoted this
   *  yacht for 2+ durations. Seeds the Periods & rates editor. Absent otherwise. */
  period_options?: { label?: string; dates?: string; fee?: number; fee_disp?: string; apa_pct?: number; vat_pct?: number; note?: string }[];
};
type CombinedExtraction = {
  yachts: YachtExtraction[];
  suggested_charter_type?: CharterType;
  suggested_terms?: Record<string, unknown>;
};

// Editor state for ONE yacht's per-yacht bareboat extras (money-box only).
// payable_at_base = label+amount rows the owner can add/remove; security_deposit
// = single line; free_onboard = one item per line (textarea).
type ExtrasState = {
  payable_at_base: { label: string; amount: string }[];
  security_deposit: string;
  free_onboard: string;
};
const EMPTY_EXTRAS: ExtrasState = { payable_at_base: [], security_deposit: "", free_onboard: "" };

// Seed the per-yacht extras editor state from the extraction's extras block.
function extrasStateFrom(x?: YachtExtras): ExtrasState {
  const pab = (Array.isArray(x?.payable_at_base) ? x!.payable_at_base : [])
    .map((p) => ({ label: (p?.label ?? "").toString(), amount: (p?.amount ?? "").toString() }))
    .filter((p) => p.label.trim() || p.amount.trim());
  return {
    payable_at_base: pab,
    security_deposit: (x?.security_deposit ?? "").toString(),
    free_onboard: (Array.isArray(x?.free_onboard) ? x!.free_onboard : []).map((s) => String(s ?? "")).join("\n"),
  };
}
// Build the per-yacht extras payload for the generate body (drop empties).
function extrasPayload(s: ExtrasState): { payable_at_base?: { label: string; amount?: string }[]; security_deposit?: string; free_onboard?: string[] } {
  const out: { payable_at_base?: { label: string; amount?: string }[]; security_deposit?: string; free_onboard?: string[] } = {};
  const pab = s.payable_at_base
    .map((p) => ({ label: p.label.trim(), amount: p.amount.trim() }))
    .filter((p) => p.label)
    .map((p) => (p.amount ? { label: p.label, amount: p.amount } : { label: p.label }));
  if (pab.length) out.payable_at_base = pab;
  const dep = s.security_deposit.trim();
  if (dep) out.security_deposit = dep;
  const fob = s.free_onboard.split("\n").map((x) => x.trim()).filter(Boolean);
  if (fob.length) out.free_onboard = fob;
  return out;
}

// "THE DOUBLE": editor state for a yacht quoted across 2+ durations. One row per
// option {label, dates, fee, note}; seeded from the merge; owner can add / edit /
// remove. Sent in the generate body; persisted in the review draft. CLIENT fees
// only — commission never goes here.
// `fee` = the numeric client charter fee (typed as "15000" or "€ 15,000"); `apa`
// + `vat` = the broker's percentages as typed (e.g. "40", "12"). When >=1 row has
// an APA % or VAT %, the PDF money box renders the FULL per-period breakdown
// (Charter / APA / VAT / ALL-IN); otherwise the simple label·dates·fee display.
type PeriodRow = { label: string; dates: string; fee: string; apa: string; vat: string; note: string };
type PeriodsState = PeriodRow[];

// Seed the periods editor from the extraction's period_options (set by the
// deterministic merge). VAT defaults to 12 (Greece) per row so the broker only
// has to type the APA %. Empty array when the yacht was quoted once.
function periodsStateFrom(opts?: { label?: string; dates?: string; fee?: number; fee_disp?: string; apa_pct?: number; vat_pct?: number; note?: string }[]): PeriodsState {
  return (Array.isArray(opts) ? opts : []).map((p) => ({
    label: (p?.label ?? "").toString(),
    dates: (p?.dates ?? "").toString(),
    // Prefer the numeric fee; fall back to the formatted string from older drafts.
    fee: p?.fee !== undefined && p?.fee !== null ? String(p.fee) : (p?.fee_disp ?? "").toString(),
    apa: p?.apa_pct !== undefined && p?.apa_pct !== null ? String(p.apa_pct) : "",
    vat: p?.vat_pct !== undefined && p?.vat_pct !== null ? String(p.vat_pct) : "12",
    note: (p?.note ?? "").toString(),
  }));
}
// Defensive normaliser: coerce EVERY period row to clean strings. Drafts saved
// BEFORE the breakdown feature have rows with no apa/vat field, so an unguarded
// `r.apa.trim()` threw "Cannot read properties of undefined (reading 'trim')" and
// crashed the request page on load (500). Every consumer of the rows (the editor
// render + the generate payload) runs them through this first — guaranteed safe.
function normPeriodsState(rows?: PeriodRow[] | null): PeriodsState {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const o = (r ?? {}) as Partial<PeriodRow>;
    return {
      label: (o.label ?? "").toString(),
      dates: (o.dates ?? "").toString(),
      fee: (o.fee ?? "").toString(),
      apa: (o.apa ?? "").toString(),
      vat: (o.vat ?? "").toString(),
      note: (o.note ?? "").toString(),
    };
  });
}
// Build the period_options payload for the generate body (drop empty rows). Sends
// numeric `fee` (and a `fee_disp` fallback) plus `apa_pct`/`vat_pct` when set, so
// the template renders the computed breakdown. Returns [] when none set.
function periodsPayload(s: PeriodsState): { label: string; dates?: string; fee?: number; fee_disp?: string; apa_pct?: number; vat_pct?: number; note?: string }[] {
  const num = (x?: string) => {
    const v = (x ?? "").trim();
    if (!v) return undefined;
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  return normPeriodsState(s)
    .map((r) => ({ label: r.label.trim(), dates: r.dates.trim(), feeRaw: r.fee.trim(), fee: num(r.fee), apa: num(r.apa), vat: num(r.vat), note: r.note.trim() }))
    .filter((r) => r.feeRaw || r.label)
    .map((r) => ({
      label: r.label || "Option",
      ...(r.fee !== undefined ? { fee: r.fee } : {}),
      ...(r.feeRaw ? { fee_disp: r.feeRaw } : {}),
      ...(r.dates ? { dates: r.dates } : {}),
      ...(r.apa !== undefined ? { apa_pct: r.apa } : {}),
      ...(r.vat !== undefined ? { vat_pct: r.vat } : {}),
      ...(r.note ? { note: r.note } : {}),
    }));
}

type MediaEntry = { main_url?: string; brochure_url?: string; extra_urls?: string[] };
type PriceMode = "breakdown" | "plus_extras" | "all_inclusive" | "day_charter";

type YState = {
  px: Record<string, string>;
  priceMode: PriceMode;
  resolved: string[];
  vessel: { name: string; type: string; spec_line: string; embarkation: string; disembarkation: string; date_from: string; date_to: string };
  /** PER-YACHT bareboat extras (money-box only). Seeded from extraction.extras;
   *  editable; sent in the generate body; persisted in the review draft. */
  extras?: ExtrasState;
  /** "THE DOUBLE": per-yacht period options (label/dates/fee/note). Seeded from
   *  extraction.period_options (the merge); editable; sent in the generate body;
   *  persisted in the review draft. Empty => single-pricing money box as before. */
  periods?: PeriodsState;
  /** Excluded from the proposal (e.g. the yacht got booked meanwhile). The card
   *  stays — nothing is deleted — it is simply left out of the generated PDF. */
  excluded?: boolean;
  /** GEORGE'S OWN Inside Info (2026-07-15). When filled, HIS words render in
   *  the PDF verbatim and the AI text is discarded for this yacht. Hard-capped
   *  at 240 chars — the exact budget the page renders. */
  manual_note?: string;
};

/** GEORGE-WRITTEN itinerary page (max 2). Replaces the retired auto sample
 *  weeks — a canned route can never cover "the client wants Syros". Limits
 *  are the exact page geometry: title 30 (one line), leg 34 (one line),
 *  note 110 (~2 lines), up to 8 days. */
type WeekState = {
  title: string;
  days: { leg: string; note: string }[];
};
const WEEK_LIMITS = { title: 30, leg: 34, note: 110, days: 8, weeks: 2 } as const;

type CharterType = "weekly" | "bareboat" | "daily" | "custom";
const CHARTER_TYPES: [CharterType, string][] = [
  ["weekly", "Weekly"], ["bareboat", "Bareboat"], ["daily", "Daily"], ["custom", "Custom"],
];

// Optional smart suggestions by charter type — a one-click seed the owner can
// edit or clear. Empty for weekly/custom (owner opts in by typing).
function suggestedTerms(ct: CharterType): TermsState {
  if (ct === "bareboat") {
    return {
      ...EMPTY_TERMS,
      included: "Use of the yacht and her equipment\nMarine insurance\nApplicable taxes & VAT",
      not_included: "Fuel\nPort fees\nFood & beverages",
      obligatory_extras: "End cleaning / transit log (paid locally per the operator)",
      security_deposit: "A refundable security deposit applies, returned after disembarkation less any damage",
      skipper: "Skipper licence required for bareboat; a professional skipper can be arranged on request",
      payment: "To be confirmed per yacht",
    };
  }
  if (ct === "daily") {
    return {
      ...EMPTY_TERMS,
      included: "The cruising hours and route for the day, with inclusions per the operator",
      payment: "To be confirmed",
    };
  }
  return { ...EMPTY_TERMS };
}

const STOP_CODES = new Set(["MISSING_APA", "MULTIPLE_SEASONAL_RATES", "DIVIDE_BY_UNCLEAR", "NO_PRICE_FOUND", "AMBIGUOUS"]);
const PRICE_FIELDS: { key: string; label: string }[] = [
  { key: "charter_fee", label: "Charter fee (net)" },
  { key: "apa_pct", label: "APA %" },
  { key: "apa_amount", label: "APA amount" },
  { key: "vat_pct", label: "VAT %" },
  { key: "vat_amount", label: "VAT amount" },
];

function ConfBadge({ c }: { c: Confidence }) {
  const map: Record<Confidence, string> = { high: "#3A6B47", medium: "#B07A2C", low: "#9CA3AF" };
  return <span style={{ fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#fff", background: map[c], padding: "1px 6px", borderRadius: 2 }}>{c}</span>;
}

function seedPx(y?: YachtExtraction): Record<string, string> {
  const o: Record<string, string> = { charter_fee: "", apa_pct: "", apa_amount: "", vat_pct: "", vat_amount: "", extras_text: "", all_inclusive_total: "", discount_pct: "", relocation_fee: "", all_in_override: "", half_day_rate: "", full_day_rate: "", half_day_label: "", full_day_label: "", currency: "EUR" };
  if (y) for (const k of Object.keys(o)) {
    const v = y.pricing?.[k]?.value;
    if (v !== null && v !== undefined && v !== "") o[k] = String(v);
  }
  // Pre-fill day-charter labels (and amounts, if quoted) from two extracted rates
  // (e.g. "Half day (5h)" / "Full day (8h)") so the broker just confirms prices.
  const sr = y?.seasonal_rates || [];
  if (sr.length >= 2) {
    o.half_day_label = sr[0].label || ""; o.full_day_label = sr[1].label || "";
    if (Number(sr[0].fee) > 0) o.half_day_rate = String(sr[0].fee);
    if (Number(sr[1].fee) > 0) o.full_day_rate = String(sr[1].fee);
  }
  return o;
}
function seedStates(ex: CombinedExtraction | null): YState[] {
  return (ex?.yachts || []).map((y) => ({
    px: seedPx(y),
    priceMode: y.suggested_mode || "breakdown",
    resolved: [],
    vessel: {
      name: y.vessel_name?.value || "", type: y.vessel_type?.value || "", spec_line: y.spec_line?.value || "",
      embarkation: y.embarkation?.value || "", disembarkation: y.disembarkation?.value || "",
      date_from: y.dates?.from?.value || "", date_to: y.dates?.to?.value || "",
    },
    extras: extrasStateFrom(y.extras),
    periods: periodsStateFrom(y.period_options),
  }));
}

// Single source of truth for a yacht's PricingInput — used by BOTH the live
// preview and the generate payload, so they are always identical.
function pricingOf(px: Record<string, string>, mode: PriceMode): PricingInput {
  const num = (x: string) => (x.trim() === "" ? null : Number(x.replace(/[^0-9.\-]/g, "")));
  return {
    mode,
    currency: px.currency || "EUR",
    charter_fee: num(px.charter_fee),
    apa_pct: num(px.apa_pct), apa_amount: num(px.apa_amount),
    vat_pct: num(px.vat_pct), vat_amount: num(px.vat_amount),
    extras_text: px.extras_text.trim() || null,
    all_inclusive_total: num(px.all_inclusive_total),
    discount_pct: num(px.discount_pct),
    relocation_fee: /[0-9]/.test(px.relocation_fee || "") ? num(px.relocation_fee) : null,
    relocation_note: ((px.relocation_fee || "").trim() && !/[0-9]/.test(px.relocation_fee || "")) ? (px.relocation_fee || "").trim() : null,
    all_in_override: num(px.all_in_override),
    half_day_rate: mode === "day_charter" ? num(px.half_day_rate) : null,
    full_day_rate: mode === "day_charter" ? num(px.full_day_rate) : null,
    half_day_label: (px.half_day_label || "").trim() || null,
    full_day_label: (px.full_day_label || "").trim() || null,
  };
}

export default function CombinedPanel({
  requestId, surname, initialExtraction, pdfPath, emailSubject, emailIntro, initialMedia, cloudinaryConfigured, initialDraft, isAgent, initialWhiteLabel,
}: {
  requestId: string;
  surname: string | null;
  initialExtraction: CombinedExtraction | null;
  pdfPath: string | null;
  emailSubject: string | null;
  emailIntro: string | null;
  initialMedia: Record<string, MediaEntry>;
  cloudinaryConfigured: boolean;
  initialDraft: { mode?: string; yachts?: YState[]; weeks?: WeekState[] } | null;
  isAgent: boolean;
  initialWhiteLabel: boolean;
}) {
  const router = useRouter();
  const [ex, setEx] = useState<CombinedExtraction | null>(initialExtraction);
  const [whiteLabel, setWhiteLabel] = useState(initialWhiteLabel);
  // Charter type + crew note are proposal-level (one per combined PDF). Charter
  // type is seeded from the OWNER's persisted choice if present, else from the
  // AI's auto-detected suggestion (suggested_charter_type), else weekly — the
  // owner confirms / changes it in the selector. Sent in the generate body.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [charterType, setCharterType] = useState<CharterType>(
    ((initialExtraction as any)?.charter_type as CharterType)
    ?? (initialExtraction?.suggested_charter_type as CharterType)
    ?? "weekly",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [crewNote, setCrewNote] = useState<string>(((initialExtraction as any)?.crew_note as string) ?? "");
  // OWNER-SELECTABLE last-page terms editor state. Seeded from the OWNER's
  // persisted terms if present, else PRE-FILLED from the AI's suggested_terms
  // (the owner edits / clears — never auto-final).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [terms, setTerms] = useState<TermsState>(() =>
    termsStateFromObject((initialExtraction as any)?.terms ?? initialExtraction?.suggested_terms),
  );
  // Restore a saved review draft when it matches the current extraction
  // (same yacht count); otherwise seed fresh from the extraction.
  const [ys, setYs] = useState<YState[]>(() => {
    const d = initialDraft;
    if (d && d.mode === "combined" && Array.isArray(d.yachts) && d.yachts.length > 0
        && d.yachts.length === (initialExtraction?.yachts?.length || 0)) {
      return d.yachts as YState[];
    }
    return seedStates(initialExtraction);
  });
  const [media, setMedia] = useState<Record<string, MediaEntry>>(initialMedia || {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [featuredIdx, setFeaturedIdx] = useState<number | null>(
    typeof (initialExtraction as any)?.featured_index === "number" ? (initialExtraction as any).featured_index : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [moreText, setMoreText] = useState("");
  // George's itinerary pages — restored from the draft independently of the
  // yacht-count check (they never depend on the extraction shape).
  const [weeks, setWeeks] = useState<WeekState[]>(
    Array.isArray(initialDraft?.weeks) ? initialDraft!.weeks!.slice(0, WEEK_LIMITS.weeks) : [],
  );
  const patchWeek = (wi: number, patch: Partial<WeekState>) =>
    setWeeks((prev) => prev.map((w, idx) => (idx === wi ? { ...w, ...patch } : w)));
  const cleanWeeksPayload = () =>
    weeks
      .map((w) => ({
        title: w.title.trim().slice(0, WEEK_LIMITS.title),
        days: w.days
          .map((d) => ({ leg: d.leg.trim().slice(0, WEEK_LIMITS.leg), note: d.note.trim().slice(0, WEEK_LIMITS.note) }))
          .filter((d) => d.leg)
          .slice(0, WEEK_LIMITS.days),
      }))
      .filter((w) => w.title && w.days.length);

  // A second supplier replied later with more yachts: extract ONLY their email
  // and APPEND the yachts. Existing cards (indexes, prices, photos, brochures)
  // are never touched — new yachts take the next indexes. Same proposal, one PDF.
  async function addMoreYachts() {
    if (!moreText.trim()) return;
    setBusy("extract-more"); setError(null); setSavedMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/extract-more`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: moreText }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "extract-more-failed");
      const merged: CombinedExtraction = j.extraction?.yachts ? j.extraction : { yachts: [] };
      const addedCount: number = j.added || 0;
      const addedOnly = merged.yachts.slice(merged.yachts.length - addedCount);
      const nextYs = [...ys, ...seedStates({ yachts: addedOnly })];
      setEx(merged);
      setYs(nextYs);
      setMoreText("");
      // Auto-save the draft so a refresh restores ALL yachts (draft restore
      // requires the yacht count to match the stored extraction).
      await fetch(`/api/helm/${requestId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_draft: { mode: "combined", yachts: nextYs, weeks } }),
      });
      setSavedMsg(`Added ${addedCount} yacht${addedCount === 1 ? "" : "s"} from the new supplier. Your earlier yachts are untouched — review the new cards, then ${pdfPath ? "Regenerate" : "Generate"}.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function saveDraft() {
    setBusy("savedraft"); setError(null); setSavedMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_draft: { mode: "combined", yachts: ys, weeks } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "save-failed");
      setSavedMsg("Draft saved — safe to refresh or come back later.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  const patchY = (i: number, patch: Partial<YState>) => setYs((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  function stopFlagsFor(i: number): { code: string; message: string }[] {
    const y = ex?.yachts?.[i];
    if (!y) return [];
    const mode = ys[i]?.priceMode;
    // Day charter is a different basis (two final rates) — its STOP flags
    // (seasonal / missing APA-VAT) do not apply once a rate is entered.
    if (mode === "day_charter") return [];
    return (y.flags || []).filter((f) => STOP_CODES.has(f.code) && !(mode === "all_inclusive" && (f.code === "MISSING_APA" || f.code === "MISSING_VAT")));
  }
  function hasFee(i: number): boolean {
    const s = ys[i]; if (!s) return false;
    if (s.priceMode === "day_charter") return Number(s.px.half_day_rate) > 0 || Number(s.px.full_day_rate) > 0;
    return s.priceMode === "all_inclusive" ? Number(s.px.all_inclusive_total) > 0 : (!!s.px.charter_fee.trim() || !!s.px.extras_text.trim());
  }
  function yachtReady(i: number): boolean {
    return hasFee(i) && stopFlagsFor(i).every((f) => ys[i].resolved.includes(f.code));
  }

  const yachtCount = ex?.yachts?.length || 0;
  // Excluded yachts neither appear in the PDF nor block Generate (their fee /
  // STOP flags can stay unresolved — the point is to drop a yacht that got taken).
  const includedCount = ys.filter((s) => !s.excluded).length;
  const allReady = includedCount > 0 && ys.every((s, i) => s.excluded || yachtReady(i));
  const canGenerate = !!ex && allReady && !!surname && busy === null;

  async function runExtract() {
    // A full re-extract reseeds every card from scratch (confirmed prices,
    // resolved flags, edits are replaced). Warn when work already exists —
    // adding a later supplier should use "Add yachts from another supplier".
    if (ex && (ex.yachts?.length || 0) > 0) {
      const ok = confirm("Re-extract ALL yachts from scratch? This resets every card (prices, resolved flags, edits). To add a new supplier's yachts WITHOUT losing your work, use 'Add yachts from another supplier' below instead.");
      if (!ok) return;
    }
    setBusy("extract"); setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/extract`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "extract-failed");
      const next: CombinedExtraction = j.extraction?.yachts ? j.extraction : { yachts: [] };
      setEx(next);
      setYs(seedStates(next));
      // Pre-select the auto-detected charter type + pre-fill the suggested terms
      // (owner confirms / edits / clears). Only applies what the AI returned.
      if (next.suggested_charter_type) setCharterType(next.suggested_charter_type);
      if (next.suggested_terms) setTerms(termsStateFromObject(next.suggested_terms));
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function runGenerate() {
    if (!canGenerate || !ex) return;
    setBusy("generate"); setError(null);
    try {
      const payload = {
        mode: "combined",
        white_label: whiteLabel,
        charter_type: charterType,
        crew_note: crewNote,
        terms: termsObjectFromState(terms) ?? null,
        // George's own itinerary pages (max 2; empty => no week pages).
        custom_weeks: cleanWeeksPayload(),
        // Excluded yachts are left out of the PDF. media_index = the ORIGINAL
        // card index, so each remaining yacht keeps ITS OWN photos/brochure
        // server-side even when an earlier card is excluded.
        yachts: ex.yachts
          .map((y, i) => ({ y, s: ys[i], i }))
          .filter(({ s }) => s && !s.excluded)
          .map(({ y, s, i }) => ({
            media_index: i,
            // George's own Inside Info — rendered verbatim, AI text discarded.
            ...(s.manual_note?.trim() ? { manual_note: s.manual_note.trim().slice(0, 240) } : {}),
            vessel: { name: s.vessel.name, type: s.vessel.type, spec_line: s.vessel.spec_line, embarkation: s.vessel.embarkation, disembarkation: s.vessel.disembarkation, date_from: s.vessel.date_from, date_to: s.vessel.date_to },
            pricing: pricingOf(s.px, s.priceMode),
            content: y.content || {},
            // PER-YACHT bareboat extras (money-box only). Empty => the route
            // sends nothing and the template renders nothing for this yacht.
            ...extrasPayload(s.extras ?? EMPTY_EXTRAS),
            // "THE DOUBLE": period options (label/dates/fee/note). Empty => the
            // single-pricing money box renders as before for this yacht.
            ...(() => { const po = periodsPayload(s.periods ?? []); return po.length ? { period_options: po } : {}; })(),
          })),
      };
      const r = await fetch(`/api/helm/${requestId}/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "generate-failed");
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  // ---- feature: pin one yacht as the lead / cover ----
  // Calls the curate endpoint; the generate route reads extraction.featured_index
  // to put this yacht first (cover + lead) while the rest keep the price ladder.
  async function toggleFeature(i: number) {
    const next = featuredIdx === i ? null : i;
    setBusy(`feat-${i}`); setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/yachts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: next === null ? "unfeature" : "feature", index: i }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "feature-failed");
      setFeaturedIdx(next);
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  // ---- gallery strip (Helm v2): up to 3 extra photos per yacht ----
  async function uploadExtraPhoto(i: number, file: File) {
    setBusy(`media-${i}`); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("kind", "extra"); fd.append("yacht_index", String(i));
      const r = await fetch(`/api/helm/${requestId}/upload-media`, { method: "POST", body: fd });
      const j = await readJsonSafe(r);
      if (!r.ok && !j.configured) throw new Error(j.error || "upload-failed");
      if (j.configured === false) { setError(j.message || "Cloudinary not connected. Paste an image link instead."); return; }
      if (j.error) throw new Error(j.error);
      if (j.combined_media) setMedia(j.combined_media);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function addExtraLink(i: number, url: string) {
    if (!url.trim()) return;
    setBusy(`media-${i}`); setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/upload-media`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-combined-extra", index: i, url: url.trim() }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || j.error) throw new Error(j.error || "link-failed");
      if (j.combined_media) setMedia(j.combined_media);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function removeExtraUrl(i: number, url: string) {
    setBusy(`media-${i}`); setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/upload-media`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove-combined-extra", index: i, url }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || j.error) throw new Error(j.error || "remove-failed");
      setMedia(j.combined_media || {});
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  // ---- per-yacht media ----
  async function uploadPhoto(i: number, file: File) {
    setBusy(`media-${i}`); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("kind", "photo"); fd.append("yacht_index", String(i));
      const r = await fetch(`/api/helm/${requestId}/upload-media`, { method: "POST", body: fd });
      const j = await readJsonSafe(r);
      if (!r.ok && !j.configured) throw new Error(j.error || "upload-failed");
      if (j.configured === false) { setError(j.message || "Cloudinary not connected. Paste an image link instead."); return; }
      if (j.error) throw new Error(j.error);
      if (j.combined_media) setMedia(j.combined_media);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  // Upload a brochure PDF for one yacht. PDFs go DIRECT browser → Supabase
  // storage (signed upload URL) to bypass Vercel's ~4.5MB serverless body cap,
  // then finalize on the server (action: finalize-brochure) to save the
  // long-lived download URL into this yacht's combined_media slot. Non-PDF
  // brochure files keep the multipart route.
  async function uploadBrochure(i: number, file: File) {
    setBusy(`media-${i}`); setError(null);
    try {
      const isPdf = (file.type || "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name || "");
      if (isPdf) {
        if (file.size > 45 * 1024 * 1024) {
          setError(`This PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is 45MB, please compress it`); return;
        }
        const ur = await fetch(`/api/helm/${requestId}/brochure-upload-url`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name }),
        });
        const u = await readJsonSafe(ur);
        if (u.error || !u.path || !u.token) { setError(u.error || "Could not start the upload."); return; }
        const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
        const { error } = await supabase.storage.from("helm-proposals").uploadToSignedUrl(u.path, u.token, file, { contentType: "application/pdf" });
        if (error) { setError(`Upload failed: ${error.message}`); return; }
        const fr = await fetch(`/api/helm/${requestId}/upload-media`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finalize-brochure", path: u.path, yacht_index: i }),
        });
        const f = await readJsonSafe(fr);
        if (f.error || !f.combined_media) { setError(f.error || "Could not save the brochure."); return; }
        setMedia(f.combined_media);
        return;
      }
      const fd = new FormData();
      fd.append("file", file); fd.append("kind", "brochure"); fd.append("yacht_index", String(i));
      const r = await fetch(`/api/helm/${requestId}/upload-media`, { method: "POST", body: fd });
      const j = await readJsonSafe(r);
      if (!r.ok && !j.configured) throw new Error(j.error || "upload-failed");
      if (j.configured === false) { setError(j.message || "Cloudinary not connected. Paste a brochure link instead."); return; }
      if (j.error) throw new Error(j.error);
      if (j.combined_media) setMedia(j.combined_media);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function setLink(i: number, field: "main_url" | "brochure_url", url: string) {
    if (!url.trim()) return;
    setBusy(`media-${i}`); setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/upload-media`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-combined-link", index: i, field, url: url.trim() }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || j.error) throw new Error(j.error || "link-failed");
      if (j.combined_media) setMedia(j.combined_media);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function removeMedia(i: number, field: "main_url" | "brochure_url") {
    setBusy(`media-${i}`); setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/upload-media`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove-combined", index: i, field }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || j.error) throw new Error(j.error || "remove-failed");
      setMedia(j.combined_media || {});
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  // ---- already generated ----
  return (
    <section style={card}>
      <div style={cardLabel}>Generate combined proposal · multi-yacht</div>

      {/* Already generated: show the current PDF + email for a final check, but
          KEEP the editable cards below so the broker can revise and regenerate. */}
      {pdfPath && (
        <div style={generatedBanner}>
          <div style={{ fontSize: 12.5, color: "#1f2937", marginBottom: 8 }}>
            <b>Proposal generated.</b> Open it for a final check, edit any yacht below, then press <b>Generate</b> at the bottom to update it.
          </div>
          <a href={`/api/helm/${requestId}/proposal-pdf`} target="_blank" rel="noreferrer" style={pdfLink}>Open current PDF ↗</a>
          {!isAgent && (
            <label style={wlToggle}>
              <input type="checkbox" checked={whiteLabel} onChange={(e) => setWhiteLabel(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                <span style={{ fontSize: 12.5, color: "#1f2937", fontWeight: 600 }}>White-label this PDF (remove all George Yachts identity — for forwarding)</span>
                <span style={{ display: "block", fontSize: 11.5, color: "#9CA3AF", marginTop: 2 }}>Re-press Generate to apply. Logos and George-voice copy are stripped; the client can forward it as their own.</span>
              </span>
            </label>
          )}
          {emailSubject && (<div style={{ marginTop: 12 }}><div style={fieldLabel}>Email subject</div><div style={{ fontSize: 14, color: "#1f2937", marginTop: 2 }}>{emailSubject}</div></div>)}
          {emailIntro && (<div style={{ marginTop: 10 }}><div style={fieldLabel}>Email body</div><pre style={emailPre}>{emailIntro}</pre></div>)}
        </div>
      )}

      {!ex && (
        <button type="button" onClick={runExtract} disabled={busy !== null} style={primaryBtn}>
          {busy === "extract" ? "Extracting every yacht…" : "Extract all yachts from supplier email"}
        </button>
      )}

      {ex && yachtCount === 0 && <p style={{ fontSize: 13, color: "#9CA3AF", fontStyle: "italic" }}>No yachts found. Re-extract, or check the supplier text.</p>}

      {ex && yachtCount > 0 && (
        <>
          <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 6 }}>
            {yachtCount} yacht{yachtCount === 1 ? "" : "s"} extracted. Confirm each one. They will be sorted cheapest to priciest by all-in automatically.
          </div>
          {!surname && <div style={warnBox}>Add a client <b>surname</b> on this request first — proposals are addressed formally (never a bare first name).</div>}

          {/* CHARTER TYPE — one choice for the whole combined proposal. Weekly
              (default) keeps the existing crewed-weekly boilerplate + money box. */}
          <div style={{ margin: "10px 0 4px", padding: "10px 12px", background: "rgba(13,27,42,0.02)", border: "1px solid rgba(13,27,42,0.1)", borderRadius: 2 }}>
            <div style={fieldLabel}>Charter type (applies to the whole proposal)</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              {CHARTER_TYPES.map(([ct, label]) => (
                <button key={ct} type="button" onClick={() => setCharterType(ct)} style={{
                  ...chipBtn,
                  background: charterType === ct ? "#0D1B2A" : "rgba(201,168,76,0.12)",
                  color: charterType === ct ? "#F8F5F0" : "#0D1B2A",
                }}>{label}</button>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={fieldLabel}>Crew &amp; extras note (optional)</div>
              <input
                value={crewNote}
                onChange={(e) => setCrewNote(e.target.value)}
                placeholder="e.g. Private skipper — not charged  ·  + Hostess available"
                style={{ ...txt, marginTop: 4 }}
              />
            </div>
            {/* OWNER-SELECTABLE last-page terms editor (collapsed by default). */}
            <TermsEditor value={terms} onChange={setTerms} />
            {charterType !== "weekly" && (
              <button
                type="button"
                onClick={() => setTerms(suggestedTerms(charterType))}
                style={{ ...ghostBtn, marginTop: 8, fontSize: 9 }}
                title="Pre-fill suggested terms for this charter type — you can then edit or clear them"
              >
                Suggest terms for {CHARTER_TYPES.find(([c]) => c === charterType)?.[1]}
              </button>
            )}
          </div>

          {ex.yachts.map((y, i) => {
            const s = ys[i]; if (!s) return null;
            const stops = stopFlagsFor(i);
            const warns = (y.flags || []).filter((f) => !STOP_CODES.has(f.code));
            const ready = yachtReady(i);
            const m = media[String(i)] || {};
            return (
              <div key={i} style={{ ...yachtBox, borderColor: s.excluded ? "rgba(13,27,42,0.1)" : ready ? "rgba(58,107,71,0.5)" : "rgba(13,27,42,0.12)", opacity: s.excluded ? 0.55 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#0D1B2A", fontWeight: 600, textDecoration: s.excluded ? "line-through" : "none" }}>
                    Yacht {i + 1}: {s.vessel.name || y.vessel_name?.value || "(unnamed)"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {featuredIdx === i && !s.excluded && (
                      <span style={{ fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#F8F5F0", background: "#0D1B2A", padding: "2px 7px", borderRadius: 2 }}>Cover</span>
                    )}
                    <span style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: s.excluded ? "#9CA3AF" : ready ? "#3A6B47" : "#B07A2C" }}>
                      {s.excluded ? "excluded from proposal" : ready ? "ready ✓" : "needs review"}
                    </span>
                    {!s.excluded && (
                      <button
                        type="button"
                        onClick={() => toggleFeature(i)}
                        disabled={busy !== null}
                        title={featuredIdx === i ? "Remove as cover — return to the cheapest→priciest order" : "Set as cover — this yacht's photo leads the proposal and it appears first; the rest keep the price order"}
                        style={{ ...ghostBtn, padding: "5px 10px", fontSize: 9, ...(featuredIdx === i ? { background: "#0D1B2A", color: "#F8F5F0", borderColor: "#C9A84C" } : {}) }}
                      >
                        {busy === `feat-${i}` ? "…" : featuredIdx === i ? "Cover ✓ — click to remove" : "Set as cover"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => patchY(i, { excluded: !s.excluded })}
                      disabled={busy !== null}
                      title={s.excluded ? "Bring this yacht back into the proposal" : "Leave this yacht out of the proposal (e.g. it got booked) — nothing is deleted"}
                      style={{ ...ghostBtn, padding: "5px 10px", fontSize: 9 }}
                    >
                      {s.excluded ? "Include again" : "Exclude"}
                    </button>
                  </div>
                </div>

                {/* vessel facts */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
                  <Labeled label="Name"><input value={s.vessel.name} onChange={(e) => patchY(i, { vessel: { ...s.vessel, name: e.target.value } })} style={txt} /></Labeled>
                  <Labeled label="Type"><input value={s.vessel.type} onChange={(e) => patchY(i, { vessel: { ...s.vessel, type: e.target.value } })} placeholder="MOTOR YACHT" style={txt} /></Labeled>
                  <Labeled label="Spec line"><input value={s.vessel.spec_line} onChange={(e) => patchY(i, { vessel: { ...s.vessel, spec_line: e.target.value } })} style={txt} /></Labeled>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
                  <Labeled label="Embarkation"><input value={s.vessel.embarkation} onChange={(e) => patchY(i, { vessel: { ...s.vessel, embarkation: e.target.value } })} placeholder="e.g. Athens" style={txt} /></Labeled>
                  <Labeled label="Disembarkation"><input value={s.vessel.disembarkation} onChange={(e) => patchY(i, { vessel: { ...s.vessel, disembarkation: e.target.value } })} placeholder="e.g. Mykonos" style={txt} /></Labeled>
                  <Labeled label="Dates from"><input value={s.vessel.date_from} onChange={(e) => patchY(i, { vessel: { ...s.vessel, date_from: e.target.value } })} placeholder="25 June" style={txt} /></Labeled>
                  <Labeled label="Dates to"><input value={s.vessel.date_to} onChange={(e) => patchY(i, { vessel: { ...s.vessel, date_to: e.target.value } })} placeholder="3 July" style={txt} /></Labeled>
                </div>

                {/* George's own Inside Info — his words verbatim, AI text discarded */}
                <div style={{ marginTop: 10 }}>
                  <div style={fieldLabel}>
                    Your Inside Info · your exact words in the PDF (empty = AI writes it)
                  </div>
                  <textarea
                    value={s.manual_note ?? ""}
                    maxLength={240}
                    rows={3}
                    onChange={(e) => patchY(i, { manual_note: e.target.value })}
                    placeholder="Write what YOU recommend about this yacht - it replaces the AI text under &quot;George's Inside Info&quot;."
                    style={{ ...txt, width: "100%", resize: "vertical", lineHeight: 1.5 }}
                  />
                  <div style={{ fontSize: 11, color: (s.manual_note?.length ?? 0) >= 240 ? "#B45309" : "#9CA3AF", textAlign: "right" }}>
                    {(s.manual_note?.length ?? 0)}/240 — the exact space the page fits, so the layout never breaks
                  </div>
                </div>

                {/* STOP flags */}
                {stops.length > 0 && (
                  <div style={stopBox}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>STOP · resolve before generating</div>
                    {stops.map((f) => (
                      <label key={f.code} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 5, cursor: "pointer" }}>
                        <input type="checkbox" checked={s.resolved.includes(f.code)} onChange={(e) => {
                          const next = e.target.checked ? [...s.resolved, f.code] : s.resolved.filter((c) => c !== f.code);
                          patchY(i, { resolved: next });
                        }} />
                        <span style={{ fontSize: 12.5 }}><b>{f.code}</b> — {f.message} <i>(tick once the correct number is in below)</i></span>
                      </label>
                    ))}
                  </div>
                )}
                {warns.length > 0 && <div style={warnBox}>{warns.map((f) => <div key={f.code} style={{ fontSize: 12 }}><b>{f.code}</b> — {f.message}</div>)}</div>}

                {/* seasonal rates: pick one (whole charter in one season), or split by day across seasons.
                    Hidden in Day charter mode — there the two rates ARE the pricing, not a season split. */}
                {y.seasonal_rates?.length > 0 && s.priceMode !== "day_charter" && (
                  <div style={{ margin: "8px 0" }}>
                    <div style={fieldLabel}>Seasonal rates — pick the one for these dates, or split by day if it spans seasons</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                      {y.seasonal_rates.map((sr, k) => (
                        <button key={k} type="button" onClick={() => patchY(i, { px: { ...s.px, charter_fee: String(sr.fee) } })} style={chipBtn}>
                          {sr.label}: € {sr.fee.toLocaleString("en-US")}
                        </button>
                      ))}
                    </div>
                    <SeasonProration
                      rates={y.seasonal_rates}
                      onApply={(total) => patchY(i, { px: { ...s.px, charter_fee: String(total) } })}
                    />
                  </div>
                )}

                {/* mode selector */}
                <div style={{ marginTop: 10 }}>
                  <div style={fieldLabel}>Pricing mode</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    {([["breakdown", "Breakdown"], ["plus_extras", "Plus extras"], ["all_inclusive", "All-inclusive"], ["day_charter", "Day charter"]] as const).map(([mm, label]) => (
                      <button key={mm} type="button" onClick={() => patchY(i, { priceMode: mm })} style={{ ...chipBtn, background: s.priceMode === mm ? "#0D1B2A" : "rgba(201,168,76,0.12)", color: s.priceMode === mm ? "#F8F5F0" : "#0D1B2A" }}>{label}</button>
                    ))}
                  </div>
                </div>

                {/* numbers + snippets */}
                <div style={{ marginTop: 10 }}>
                  {s.priceMode === "day_charter" ? (
                    <>
                      <div style={priceRow}>
                        <input value={s.px.half_day_label} onChange={(e) => patchY(i, { px: { ...s.px, half_day_label: e.target.value } })} placeholder="Half day (5h)" style={{ ...priceInput, width: 120 }} />
                        <input value={s.px.half_day_rate} onChange={(e) => patchY(i, { px: { ...s.px, half_day_rate: e.target.value } })} placeholder="final € for half day" style={priceInput} />
                      </div>
                      <div style={priceRow}>
                        <input value={s.px.full_day_label} onChange={(e) => patchY(i, { px: { ...s.px, full_day_label: e.target.value } })} placeholder="Full day (8h)" style={{ ...priceInput, width: 120 }} />
                        <input value={s.px.full_day_rate} onChange={(e) => patchY(i, { px: { ...s.px, full_day_rate: e.target.value } })} placeholder="final € for full day" style={priceInput} />
                      </div>
                      <div style={{ fontSize: 11.5, color: "#9CA3AF", marginTop: 4 }}>Both are FINAL client prices — shown as two lines on the proposal, no APA / VAT / per-guest added.</div>
                    </>
                  ) : s.priceMode === "all_inclusive" ? (
                    <div style={priceRow}>
                      <div style={{ width: 130, fontSize: 12.5, color: "#374151" }}>All-inclusive total (EUR)</div>
                      <input value={s.px.all_inclusive_total} onChange={(e) => patchY(i, { px: { ...s.px, all_inclusive_total: e.target.value } })} placeholder="e.g. 200000" style={priceInput} />
                      {y.pricing?.all_inclusive_total?.confidence ? <ConfBadge c={y.pricing.all_inclusive_total.confidence} /> : <span style={{ width: 52 }} />}
                      <div style={snippetStyle}>{y.pricing?.all_inclusive_total?.snippet ? `“${y.pricing.all_inclusive_total.snippet}”` : <span style={{ color: "#cbd5e1" }}>no snippet</span>}</div>
                    </div>
                  ) : (
                    <>
                      {PRICE_FIELDS.map(({ key, label }) => {
                        const fld = y.pricing?.[key];
                        return (
                          <div key={key} style={priceRow}>
                            <div style={{ width: 130, fontSize: 12.5, color: "#374151" }}>{label}</div>
                            <input value={s.px[key] ?? ""} onChange={(e) => patchY(i, { px: { ...s.px, [key]: e.target.value } })} placeholder="-" style={priceInput} />
                            {fld?.value !== null && fld?.value !== undefined && fld?.confidence ? <ConfBadge c={fld.confidence} /> : <span style={{ width: 52 }} />}
                            <div style={snippetStyle}>{fld?.snippet ? `“${fld.snippet}”` : <span style={{ color: "#cbd5e1" }}>no snippet</span>}</div>
                          </div>
                        );
                      })}
                      <div style={priceRow}>
                        <div style={{ width: 130, fontSize: 12.5, color: "#374151" }}>Plus-extras text</div>
                        <input value={s.px.extras_text} onChange={(e) => patchY(i, { px: { ...s.px, extras_text: e.target.value } })} placeholder="e.g. plus expenses (only if no APA/VAT)" style={{ ...priceInput, width: 260 }} />
                        <span style={{ width: 52 }} />
                        <div style={snippetStyle}>{y.pricing?.extras_text?.snippet ? `“${y.pricing.extras_text.snippet}”` : ""}</div>
                      </div>
                    </>
                  )}
                </div>

                {/* owner discount / relocation / rounding + live preview (breakdown only) */}
                {s.priceMode === "breakdown" && (
                  <PricingExtras
                    pricing={pricingOf(s.px, s.priceMode)}
                    discount={s.px.discount_pct}
                    relocation={s.px.relocation_fee}
                    override={s.px.all_in_override}
                    onChange={(k, v) => patchY(i, { px: { ...s.px, [k]: v } })}
                  />
                )}

                {/* per-yacht media */}
                <div style={{ marginTop: 10, borderTop: "1px solid rgba(13,27,42,0.07)", paddingTop: 8 }}>
                  <div style={fieldLabel}>Photo for this yacht (shown on its page + the cover if it is cheapest)</div>
                  {m.main_url ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.main_url} alt="" style={{ width: 86, height: 56, objectFit: "cover", borderRadius: 2, border: "1px solid rgba(13,27,42,0.15)" }} />
                      <button type="button" onClick={() => removeMedia(i, "main_url")} disabled={busy !== null} style={ghostBtn}>Remove photo</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                      {cloudinaryConfigured && (
                        <label style={{ ...chipBtn, cursor: "pointer" }}>
                          {busy === `media-${i}` ? "Uploading…" : "Upload photo"}
                          <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(i, f); }} />
                        </label>
                      )}
                      <LinkAdder placeholder="…or paste image URL" disabled={busy !== null} onAdd={(u) => setLink(i, "main_url", u)} />
                    </div>
                  )}
                  {/* Gallery strip (Helm v2): up to 3 extra photos rendered under
                      the hero on this yacht's PDF page. Own-fleet yachts fill
                      these automatically when left empty. */}
                  <div style={{ marginTop: 8 }}>
                    <div style={fieldLabel}>More photos for the gallery strip (optional · up to 3 · interior, deck, dining)</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                      {(m.extra_urls || []).map((u) => (
                        <div key={u} style={{ position: "relative" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="" style={{ width: 64, height: 42, objectFit: "cover", borderRadius: 2, border: "1px solid rgba(13,27,42,0.15)" }} />
                          <button type="button" onClick={() => removeExtraUrl(i, u)} disabled={busy !== null}
                            title="Remove"
                            style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, lineHeight: "16px", padding: 0, borderRadius: 9, border: "1px solid rgba(13,27,42,0.25)", background: "#fff", cursor: "pointer", fontSize: 11 }}>×</button>
                        </div>
                      ))}
                      {(m.extra_urls || []).length < 3 && (
                        <>
                          {cloudinaryConfigured && (
                            <label style={{ ...chipBtn, cursor: "pointer" }}>
                              {busy === `media-${i}` ? "Uploading…" : "Upload photo"}
                              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadExtraPhoto(i, f); e.target.value = ""; }} />
                            </label>
                          )}
                          <LinkAdder placeholder="…or paste image URL" disabled={busy !== null} onAdd={(u) => addExtraLink(i, u)} />
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={fieldLabel}>Brochure (optional · make sure it is white-label, no agency branding)</div>
                    {m.brochure_url ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                        <a href={m.brochure_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#374151", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.brochure_url}</a>
                        <button type="button" onClick={() => removeMedia(i, "brochure_url")} disabled={busy !== null} style={ghostBtn}>Remove</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                        {cloudinaryConfigured && (
                          <label style={{ ...chipBtn, cursor: "pointer" }}>
                            {busy === `media-${i}` ? "Uploading…" : "Upload PDF"}
                            <input type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBrochure(i, f); e.target.value = ""; }} />
                          </label>
                        )}
                        <LinkAdder placeholder="…or paste brochure URL" disabled={busy !== null} onAdd={(u) => setLink(i, "brochure_url", u)} />
                      </div>
                    )}
                  </div>
                </div>

                {/* "THE DOUBLE": this yacht quoted across 2+ durations. Seeded by
                    the merge; the owner can add a period to ANY yacht. When >=1
                    period is set, the money box shows a PERIODS & RATES table
                    INSTEAD of the single fee rows. */}
                <PeriodsEditor
                  value={s.periods ?? []}
                  onChange={(next) => patchY(i, { periods: next })}
                />

                {/* PER-YACHT bareboat extras — this yacht's OWN money-box extras
                    (payable at base, security deposit, complimentary on board).
                    Most relevant for bareboat; shown for every non-weekly type. */}
                {charterType !== "weekly" && (
                  <YachtExtrasEditor
                    value={s.extras ?? EMPTY_EXTRAS}
                    onChange={(next) => patchY(i, { extras: next })}
                  />
                )}
              </div>
            );
          })}

          <div style={{ border: "1px solid rgba(13,27,42,0.10)", padding: "12px 14px", margin: "14px 0 6px", borderRadius: 2 }}>
            {/* George's itinerary pages — HE writes the route, the PDF typesets it.
                Replaces the retired auto sample weeks (they could never cover
                "the client wants Syros"). Hard limits = the exact page geometry. */}
            <div style={{ marginTop: 14 }}>
              <div style={fieldLabel}>Itinerary pages · you write them, the PDF typesets them</div>
              <div style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 8px" }}>
                Write the route exactly as you would propose it (e.g. Syros). Each itinerary becomes one elegant
                &quot;A Week Like This&quot; page. Character limits match the page exactly, so nothing ever overflows.
                Leave empty for no itinerary pages.
              </div>
              {weeks.map((w, wi) => (
                <div key={wi} style={{ border: "1px solid rgba(13,27,42,0.10)", borderRadius: 2, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      value={w.title}
                      maxLength={WEEK_LIMITS.title}
                      onChange={(e) => patchWeek(wi, { title: e.target.value })}
                      placeholder="Title, e.g. Syros &amp; the Western Cyclades"
                      style={{ ...txt, flex: 1 }}
                    />
                    <span style={{ fontSize: 11, color: "#9CA3AF" }}>{w.title.length}/{WEEK_LIMITS.title}</span>
                    <button type="button" onClick={() => setWeeks((prev) => prev.filter((_, idx) => idx !== wi))} disabled={busy !== null} style={ghostBtn}>
                      Remove itinerary
                    </button>
                  </div>
                  {w.days.map((day, di) => (
                    <div key={di} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                      <span style={{ fontSize: 11, letterSpacing: 1, color: "#9CA3AF", width: 42, flexShrink: 0 }}>Day {di + 1}</span>
                      <input
                        value={day.leg}
                        maxLength={WEEK_LIMITS.leg}
                        onChange={(e) => patchWeek(wi, { days: w.days.map((d, idx) => (idx === di ? { ...d, leg: e.target.value } : d)) })}
                        placeholder="Athens -&gt; Syros"
                        style={{ ...txt, width: 200, flexShrink: 0 }}
                      />
                      <input
                        value={day.note}
                        maxLength={WEEK_LIMITS.note}
                        onChange={(e) => patchWeek(wi, { days: w.days.map((d, idx) => (idx === di ? { ...d, note: e.target.value } : d)) })}
                        placeholder="Short line about the day (swim stop, harbour, dinner...)"
                        style={{ ...txt, flex: 1 }}
                      />
                      <span style={{ fontSize: 10.5, color: day.note.length >= WEEK_LIMITS.note ? "#B45309" : "#9CA3AF", width: 52, flexShrink: 0, textAlign: "right" }}>
                        {day.note.length}/{WEEK_LIMITS.note}
                      </span>
                      <button type="button" onClick={() => patchWeek(wi, { days: w.days.filter((_, idx) => idx !== di) })} disabled={busy !== null}
                        style={{ ...ghostBtn, padding: "2px 8px" }}>&times;</button>
                    </div>
                  ))}
                  {w.days.length < WEEK_LIMITS.days && (
                    <button type="button" onClick={() => patchWeek(wi, { days: [...w.days, { leg: "", note: "" }] })} disabled={busy !== null}
                      style={{ ...ghostBtn, marginTop: 8 }}>
                      + Add day ({w.days.length}/{WEEK_LIMITS.days})
                    </button>
                  )}
                </div>
              ))}
              {weeks.length < WEEK_LIMITS.weeks && (
                <button type="button" disabled={busy !== null} style={ghostBtn}
                  onClick={() => setWeeks((prev) => [...prev, { title: "", days: Array.from({ length: 7 }, () => ({ leg: "", note: "" })) }])}>
                  + Add itinerary page ({weeks.length}/{WEEK_LIMITS.weeks})
                </button>
              )}
              <div style={{ fontSize: 11.5, color: "#9CA3AF", marginTop: 6 }}>
                Remember to press <b>Save draft</b> below - itineraries are saved with the draft and go into the PDF on Generate.
              </div>
            </div>

          </div>

          <div style={{ border: "1px dashed rgba(13,27,42,0.25)", padding: "12px 14px", margin: "14px 0 6px", borderRadius: 2 }}>
            <div style={fieldLabel}>Add yachts from another supplier</div>
            <div style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 8px" }}>
              A second supplier replied? Paste their email here — only their yachts are extracted and added as new cards. Everything you have already set on the yachts above stays exactly as it is. Same proposal, one PDF.
            </div>
            <textarea
              value={moreText}
              onChange={(e) => setMoreText(e.target.value)}
              rows={5}
              placeholder="Paste the new supplier's email…"
              style={{ width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 }}
            />
            <button type="button" onClick={addMoreYachts} disabled={busy !== null || !moreText.trim()} style={{ ...ghostBtn, marginTop: 8 }}>
              {busy === "extract-more" ? "Extracting new yachts…" : "Extract & add these yachts"}
            </button>
          </div>

          <button type="button" onClick={runGenerate} disabled={!canGenerate} style={{ ...primaryBtn, marginTop: 8, opacity: canGenerate ? 1 : 0.5, cursor: canGenerate ? "pointer" : "not-allowed" }}>
            {busy === "generate" ? "Generating…" : pdfPath ? `Regenerate proposal (${includedCount} yacht${includedCount === 1 ? "" : "s"})` : `Generate combined proposal (${includedCount} yacht${includedCount === 1 ? "" : "s"})`}
          </button>
          {includedCount < yachtCount && (
            <div style={{ fontSize: 11.5, color: "#9CA3AF", marginTop: 6 }}>
              {yachtCount - includedCount} excluded yacht{yachtCount - includedCount === 1 ? "" : "s"} will be left out of the PDF (nothing is deleted — press Include again to bring one back).
            </div>
          )}
          {!canGenerate && busy === null && (
            <div style={{ fontSize: 11.5, color: "#9CA3AF", marginTop: 6 }}>
              {!surname ? "Add a client surname. " : ""}
              {includedCount === 0 ? "Every yacht is excluded — include at least one. " : !allReady ? "Every included yacht must be ready (fee set + all STOP flags resolved). " : ""}
            </div>
          )}
          <button type="button" onClick={saveDraft} disabled={busy !== null} style={{ ...ghostBtn, marginTop: 10, marginRight: 8 }}>
            {busy === "savedraft" ? "Saving…" : "Save draft"}
          </button>
          <button type="button" onClick={runExtract} disabled={busy !== null} style={{ ...ghostBtn, marginTop: 10 }}>
            {busy === "extract" ? "Re-extracting…" : "Re-extract all yachts"}
          </button>
        </>
      )}

      {savedMsg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 8 }}>{savedMsg}</p>}
      {error && <p style={errStyle}>{error}</p>}
    </section>
  );
}

function LinkAdder({ placeholder, disabled, onAdd }: { placeholder: string; disabled: boolean; onAdd: (u: string) => void }) {
  const [v, setV] = useState("");
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} style={{ ...priceInput, width: 240 }} />
      <button type="button" disabled={disabled || !v.trim()} onClick={() => { onAdd(v); setV(""); }} style={chipBtn}>Add</button>
    </span>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "block" }}><div style={fieldLabel}>{label}</div><div style={{ marginTop: 4 }}>{children}</div></label>;
}

// "THE DOUBLE" — periods & rates editor. One row per duration {label, dates,
// fee, note}. Seeded from the deterministic merge (so a yacht the supplier quoted
// twice arrives pre-filled), but addable to ANY yacht. When >=1 row has a fee or
// label, the money box renders a compact PERIODS & RATES table INSTEAD of the
// single fee rows. CLIENT fees only — commission never goes here. Auto-opens when
// seeded so the merged double is immediately visible to the owner.
function PeriodsEditor({ value: rawValue, onChange }: { value: PeriodsState; onChange: (next: PeriodsState) => void }) {
  // Normalise once so a legacy draft (rows without apa/vat) can never crash the
  // `.trim()` calls below — this is the exact 500 the request page hit on load.
  const value = normPeriodsState(rawValue);
  const seeded = value.some((r) => r.label.trim() || r.fee.trim() || r.dates.trim());
  const [open, setOpen] = useState(seeded);
  const has = seeded;
  const setRow = (idx: number, patch: Partial<PeriodRow>) =>
    onChange(value.map((r, k) => (k === idx ? { ...r, ...patch } : r)));
  const addRow = () => onChange([...value, { label: "", dates: "", fee: "", apa: "", vat: "12", note: "" }]);
  const removeRow = (idx: number) => onChange(value.filter((_, k) => k !== idx));
  // One-click: copy the FIRST non-empty APA % across every period of this yacht
  // (the broker usually quotes one APA % for the whole yacht).
  const applyApaToAll = () => {
    const apa = (value.find((r) => r.apa.trim())?.apa ?? "").trim();
    if (!apa) return;
    onChange(value.map((r) => ({ ...r, apa })));
  };
  // The breakdown table appears once any row has an APA % or VAT % set.
  const showsBreakdown = value.some((r) => r.apa.trim() || r.vat.trim());

  return (
    <div style={{ marginTop: 10, border: "1px solid rgba(13,27,42,0.12)", borderRadius: 2, background: "rgba(201,168,76,0.04)" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={extrasHead}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{open ? "▾" : "▸"}</span>
          <span>Periods &amp; rates (the double)</span>
          {has && <span style={extrasBadge}>{value.filter((r) => r.fee.trim() || r.label.trim()).length} set</span>}
        </span>
        <span style={{ fontSize: 11, color: "#9CA3AF", textTransform: "none", letterSpacing: 0 }}>
          {open ? "two durations on one card" : "optional"}
        </span>
      </button>
      {open && (
        <div style={{ padding: "10px 12px 12px" }}>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 10, lineHeight: 1.5 }}>
            Same yacht, more than one duration (e.g. 5 nights <b>and</b> 7 nights). Fees are <b>client-facing</b>
            {" "}(after any discount) — commission never goes here. Type an <b>APA %</b> (e.g. 40) and the price box
            shows the full <b>Charter fee / APA / VAT / all-in</b> breakdown per period; leave APA blank to keep the
            simple fee line. VAT defaults to 12% (Greece). Leave empty to keep the single price.
          </div>
          {value.map((r, k) => (
            <div key={k} style={{ border: "1px solid rgba(13,27,42,0.1)", borderRadius: 2, padding: "8px 9px", marginTop: 8, background: "#fff" }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input value={r.label} onChange={(e) => setRow(k, { label: e.target.value })} placeholder="5 nights" style={{ ...txt, width: 96 }} />
                <input value={r.dates} onChange={(e) => setRow(k, { dates: e.target.value })} placeholder="31 Aug – 5 Sep 2026" style={{ ...txt, flex: 1 }} />
                <button type="button" onClick={() => removeRow(k)} style={{ ...ghostBtn, padding: "6px 9px", fontSize: 9 }}>✕</button>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                <label style={{ ...numCellLabel }}>Fee
                  <input value={r.fee} onChange={(e) => setRow(k, { fee: e.target.value })} placeholder="€ 15,000" style={{ ...priceInput, width: 110, marginTop: 3 }} />
                </label>
                <label style={{ ...numCellLabel }}>APA %
                  <input value={r.apa} onChange={(e) => setRow(k, { apa: e.target.value })} placeholder="40" style={{ ...priceInput, width: 64, marginTop: 3 }} />
                </label>
                <label style={{ ...numCellLabel }}>VAT %
                  <input value={r.vat} onChange={(e) => setRow(k, { vat: e.target.value })} placeholder="12" style={{ ...priceInput, width: 64, marginTop: 3 }} />
                </label>
              </div>
              <input value={r.note} onChange={(e) => setRow(k, { note: e.target.value })} placeholder="optional note — e.g. 8% offer, from € 24,000" style={{ ...txt, marginTop: 6 }} />
            </div>
          ))}
          <button type="button" onClick={addRow} style={{ ...ghostBtn, marginTop: 8, fontSize: 9 }}>+ Add period</button>
          {value.length > 1 && value.some((r) => r.apa.trim()) && (
            <button type="button" onClick={applyApaToAll} style={{ ...ghostBtn, marginTop: 8, marginLeft: 8, fontSize: 9 }}>
              Apply APA % to all
            </button>
          )}
          {has && (
            <button type="button" onClick={() => onChange([])} style={{ ...ghostBtn, marginTop: 8, marginLeft: 8, color: "#7f1d1d", borderColor: "rgba(177,74,58,0.4)", fontSize: 9 }}>
              Clear periods
            </button>
          )}
          {showsBreakdown && (
            <div style={{ fontSize: 11, color: "#3A6B47", marginTop: 8 }}>
              The PDF will show a Charter fee / APA / VAT / all-in breakdown per period.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// PER-YACHT bareboat extras editor (money-box only). Collapsed by default,
// unobtrusive. Payable-at-base = add/remove label+amount rows; security deposit
// = one line; complimentary on board = one item per line. These render compactly
// INSIDE this yacht's money box (never the last page) and carry NO commission.
function YachtExtrasEditor({ value, onChange }: { value: ExtrasState; onChange: (next: ExtrasState) => void }) {
  const [open, setOpen] = useState(false);
  const has = value.payable_at_base.some((p) => p.label.trim() || p.amount.trim())
    || !!value.security_deposit.trim()
    || !!value.free_onboard.trim();
  const setPab = (idx: number, patch: Partial<{ label: string; amount: string }>) =>
    onChange({ ...value, payable_at_base: value.payable_at_base.map((p, k) => (k === idx ? { ...p, ...patch } : p)) });
  const addPab = () => onChange({ ...value, payable_at_base: [...value.payable_at_base, { label: "", amount: "" }] });
  const removePab = (idx: number) => onChange({ ...value, payable_at_base: value.payable_at_base.filter((_, k) => k !== idx) });

  return (
    <div style={{ marginTop: 10, border: "1px solid rgba(13,27,42,0.12)", borderRadius: 2, background: "rgba(13,27,42,0.015)" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={extrasHead}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{open ? "▾" : "▸"}</span>
          <span>This yacht&apos;s extras (money box)</span>
          {has && <span style={extrasBadge}>set</span>}
        </span>
        <span style={{ fontSize: 11, color: "#9CA3AF", textTransform: "none", letterSpacing: 0 }}>
          {open ? "payable at base · deposit · on board" : "optional"}
        </span>
      </button>
      {open && (
        <div style={{ padding: "10px 12px 12px" }}>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 10, lineHeight: 1.5 }}>
            Shown in <b>this yacht&apos;s</b> price box (not the last page). Each yacht carries its own. Leave blank to hide. Commission / price-to-agency never goes here.
          </div>

          <div style={fieldLabel}>Payable at base / obligatory extras</div>
          {value.payable_at_base.map((p, k) => (
            <div key={k} style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
              <input value={p.label} onChange={(e) => setPab(k, { label: e.target.value })} placeholder="e.g. Charter Pack — end cleaning, linen, gas, fuel, mooring" style={{ ...txt, flex: 1 }} />
              <input value={p.amount} onChange={(e) => setPab(k, { amount: e.target.value })} placeholder="EUR 250" style={{ ...priceInput, width: 110 }} />
              <button type="button" onClick={() => removePab(k)} style={{ ...ghostBtn, padding: "6px 9px", fontSize: 9 }}>✕</button>
            </div>
          ))}
          <button type="button" onClick={addPab} style={{ ...ghostBtn, marginTop: 6, fontSize: 9 }}>+ Add item</button>

          <div style={{ marginTop: 12 }}>
            <div style={fieldLabel}>Security deposit</div>
            <input value={value.security_deposit} onChange={(e) => onChange({ ...value, security_deposit: e.target.value })} placeholder="EUR 3,000 refundable (card at base)" style={{ ...txt, marginTop: 4 }} />
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={fieldLabel}>Complimentary on board (one per line)</div>
            <textarea value={value.free_onboard} onChange={(e) => onChange({ ...value, free_onboard: e.target.value })} rows={3} placeholder={"1 SUP\nWelcome Pack\nEspresso maker\nSnorkelling gear"} style={{ ...txt, marginTop: 4, resize: "vertical", lineHeight: 1.5 }} />
          </div>

          {has && (
            <button type="button" onClick={() => onChange({ payable_at_base: [], security_deposit: "", free_onboard: "" })} style={{ ...ghostBtn, marginTop: 10, color: "#7f1d1d", borderColor: "rgba(177,74,58,0.4)", fontSize: 9 }}>
              Clear this yacht&apos;s extras
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const extrasHead: React.CSSProperties = { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "9px 11px", background: "transparent", border: "none", cursor: "pointer", fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", color: "#0D1B2A", fontWeight: 600 };
const extrasBadge: React.CSSProperties = { fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#F8F5F0", background: "#3A6B47", padding: "1px 6px", borderRadius: 2 };

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 };
const fieldLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" };
const yachtBox: React.CSSProperties = { border: "1px solid rgba(13,27,42,0.12)", borderLeft: "3px solid #C9A84C", padding: "12px 14px", marginTop: 12, background: "rgba(13,27,42,0.015)" };
const primaryBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "7px 12px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer" };
const chipBtn: React.CSSProperties = { background: "rgba(201,168,76,0.12)", color: "#0D1B2A", border: "1px solid #C9A84C", padding: "6px 12px", fontSize: 12, cursor: "pointer" };
const priceRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "4px 0" };
const priceInput: React.CSSProperties = { width: 120, padding: 7, border: "1px solid rgba(13,27,42,0.2)", fontSize: 13, fontFamily: "inherit" };
const snippetStyle: React.CSSProperties = { flex: 1, fontSize: 12, color: "#6b7280", fontStyle: "italic" };
const txt: React.CSSProperties = { width: "100%", padding: 7, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit" };
// Small stacked label over a numeric input in the periods breakdown editor.
const numCellLabel: React.CSSProperties = { display: "flex", flexDirection: "column", fontSize: 9.5, letterSpacing: 0.8, textTransform: "uppercase", color: "#9CA3AF" };
const stopBox: React.CSSProperties = { background: "rgba(177,74,58,0.08)", border: "1px solid rgba(177,74,58,0.5)", color: "#7f1d1d", padding: "8px 10px", margin: "10px 0", fontSize: 13 };
const warnBox: React.CSSProperties = { background: "rgba(176,122,44,0.08)", border: "1px solid rgba(176,122,44,0.4)", color: "#7c4a03", padding: "8px 12px", margin: "10px 0", fontSize: 12.5 };
const pdfLink: React.CSSProperties = { display: "inline-block", background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", textDecoration: "none", fontSize: 10, letterSpacing: 2, textTransform: "uppercase" };
const generatedBanner: React.CSSProperties = { background: "rgba(58,107,71,0.07)", border: "1px solid rgba(58,107,71,0.35)", padding: "12px 14px", margin: "10px 0 14px", borderRadius: 2 };
const wlToggle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, padding: "10px 12px", background: "#fff", border: "1px solid rgba(13,27,42,0.12)", borderRadius: 2, cursor: "pointer" };
const emailPre: React.CSSProperties = { whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.55, color: "#1f2937", marginTop: 4, background: "rgba(13,27,42,0.03)", padding: 12 };
const errStyle: React.CSSProperties = { color: "#b91c1c", fontSize: 12, marginTop: 8 };
