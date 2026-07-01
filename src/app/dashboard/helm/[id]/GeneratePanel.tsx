"use client";

// The Helm — Generate flow + human pricing-review screen.
//
// NON-NEGOTIABLES (George):
//  1. NOTHING is computed or sent until "Generate" is pressed. Generate is
//     DISABLED while any STOP flag is unresolved (missing APA / seasonal
//     rates / divide-by-N ambiguity) or no fee is set.
//  2. Every number shows its EXACT supplier snippet beside it for a 5-second
//     eyeball check.

import { useState } from "react";
import { useRouter } from "next/navigation";
import SeasonProration from "./SeasonProration";
import PricingExtras from "./PricingExtras";
import TermsEditor, { type TermsState, EMPTY_TERMS, termsStateFromObject, termsObjectFromState } from "./TermsEditor";
import type { PricingInput } from "@/lib/helm/pricing";

type Confidence = "high" | "medium" | "low";
type Field<T> = { value: T | null; confidence: Confidence; snippet: string };
type Extraction = {
  vessel_name: Field<string>;
  vessel_type: Field<string>;
  spec_line: Field<string>;
  pricing: Record<string, Field<number | string>>;
  seasonal_rates: { label: string; fee: number; snippet: string }[];
  dates: { from: Field<string>; to: Field<string> };
  embarkation?: Field<string>;
  disembarkation?: Field<string>;
  content?: Record<string, unknown>;
  suggested_mode?: "breakdown" | "plus_extras" | "all_inclusive";
  flags: { code: string; message: string }[];
  notes?: string;
  /** Charter product type, persisted in the extraction JSON (default weekly). */
  charter_type?: CharterType;
  /** Optional crew/extras note, persisted in the extraction JSON. */
  crew_note?: string;
  /** Optional owner-selectable last-page terms, persisted in the extraction JSON. */
  terms?: Record<string, unknown>;
};

type CharterType = "weekly" | "bareboat" | "daily" | "custom";
const CHARTER_TYPES: [CharterType, string][] = [
  ["weekly", "Weekly"], ["bareboat", "Bareboat"], ["daily", "Daily"], ["custom", "Custom"],
];

// Pricing modes for the single-yacht panel. "day_charter" quotes two FINAL
// all-in rates (half day / full day) shown as-is — no APA/VAT/MYBA.
type PMode = "breakdown" | "plus_extras" | "all_inclusive" | "day_charter";

// Optional smart suggestions by charter type — offered ONLY when the owner has no
// terms set yet (a one-click seed they can then edit or clear). Empty for weekly:
// the standard MYBA last page stays the default unless the owner opts in.
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
      obligatory_extras: "",
      free_onboard: "",
      payment: "To be confirmed",
    };
  }
  // weekly + custom: no auto-seed (owner opts in by typing).
  return { ...EMPTY_TERMS };
}

const STOP_CODES = new Set([
  "MISSING_APA", "MULTIPLE_SEASONAL_RATES", "DIVIDE_BY_UNCLEAR", "NO_PRICE_FOUND", "AMBIGUOUS",
]);

const PRICE_FIELDS: { key: string; label: string }[] = [
  { key: "charter_fee", label: "Charter fee (net)" },
  { key: "apa_pct", label: "APA %" },
  { key: "apa_amount", label: "APA amount" },
  { key: "vat_pct", label: "VAT %" },
  { key: "vat_amount", label: "VAT amount" },
];

function ConfBadge({ c }: { c: Confidence }) {
  const map: Record<Confidence, string> = { high: "#3A6B47", medium: "#B07A2C", low: "#9CA3AF" };
  return (
    <span style={{ fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#fff", background: map[c], padding: "1px 6px", borderRadius: 2 }}>
      {c}
    </span>
  );
}

// Single source of truth for the PricingInput — used by the live preview and
// the generate payload, so they are always identical.
function pricingOf(px: Record<string, string>, mode: PMode): PricingInput {
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
    half_day_label: mode === "day_charter" ? ((px.half_day_label || "").trim() || null) : null,
    full_day_label: mode === "day_charter" ? ((px.full_day_label || "").trim() || null) : null,
  };
}

type SingleVessel = { name: string; type: string; spec_line: string; period_line: string; price_sub: string; embarkation: string; disembarkation: string; date_from: string; date_to: string };

export default function GeneratePanel({
  requestId, hasSupplier, surname, mode, initialExtraction, pdfPath, emailSubject, emailIntro, initialDraft, isAgent, initialWhiteLabel,
}: {
  requestId: string;
  hasSupplier: boolean;
  surname: string | null;
  mode: string | null;
  initialExtraction: Extraction | null;
  pdfPath: string | null;
  emailSubject: string | null;
  emailIntro: string | null;
  initialDraft: { mode?: string; px?: Record<string, string>; priceMode?: PMode; resolved?: string[]; vessel?: SingleVessel } | null;
  isAgent: boolean;
  initialWhiteLabel: boolean;
}) {
  const router = useRouter();
  const [ex, setEx] = useState<Extraction | null>(initialExtraction);
  const [whiteLabel, setWhiteLabel] = useState(initialWhiteLabel);
  // Charter type + crew note, seeded from the persisted extraction (default
  // weekly). Sent in the generate POST body alongside the pricing.
  const [charterType, setCharterType] = useState<CharterType>(initialExtraction?.charter_type ?? "weekly");
  const [crewNote, setCrewNote] = useState<string>(initialExtraction?.crew_note ?? "");
  // OWNER-SELECTABLE last-page terms editor state, seeded from extraction.terms.
  const [terms, setTerms] = useState<TermsState>(() => termsStateFromObject(initialExtraction?.terms));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable copies, seeded from the extraction.
  const seedPrice = (e: Extraction | null) => {
    const o: Record<string, string> = { charter_fee: "", apa_pct: "", apa_amount: "", vat_pct: "", vat_amount: "", extras_text: "", all_inclusive_total: "", discount_pct: "", relocation_fee: "", all_in_override: "", half_day_rate: "", full_day_rate: "", half_day_label: "", full_day_label: "", currency: "EUR" };
    if (e) for (const k of Object.keys(o)) {
      const v = e.pricing?.[k]?.value;
      if (v !== null && v !== undefined && v !== "") o[k] = String(v);
    }
    // Day-charter convenience: pre-fill the two rate labels + any first/second
    // seasonal rate as the half/full-day amounts (all still freely editable).
    const sr = e?.seasonal_rates ?? [];
    if (!o.half_day_label) o.half_day_label = "Half day (5h)";
    if (!o.full_day_label) o.full_day_label = "Full day (8h)";
    if (!o.half_day_rate && sr[0]?.fee) o.half_day_rate = String(sr[0].fee);
    if (!o.full_day_rate && sr[1]?.fee) o.full_day_rate = String(sr[1].fee);
    return o;
  };
  // Restore a saved single-yacht review draft on load (else seed from extraction).
  const draft = (initialDraft && initialDraft.mode === "single") ? initialDraft : null;
  const [px, setPx] = useState<Record<string, string>>(draft?.px ?? seedPrice(initialExtraction));
  const [priceMode, setPriceMode] = useState<PMode>(draft?.priceMode ?? initialExtraction?.suggested_mode ?? "breakdown");
  const [vessel, setVessel] = useState<SingleVessel>(draft?.vessel ?? {
    name: initialExtraction?.vessel_name?.value || "",
    type: initialExtraction?.vessel_type?.value || "",
    spec_line: initialExtraction?.spec_line?.value || "",
    period_line: "",
    price_sub: "",
    embarkation: initialExtraction?.embarkation?.value || "",
    disembarkation: initialExtraction?.disembarkation?.value || "",
    date_from: initialExtraction?.dates?.from?.value || "",
    date_to: initialExtraction?.dates?.to?.value || "",
  });
  const [resolved, setResolved] = useState<Set<string>>(new Set(draft?.resolved ?? []));
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function saveDraft() {
    setBusy("savedraft"); setError(null); setSavedMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_draft: { mode: "single", px, priceMode, resolved: [...resolved], vessel } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "save-failed");
      setSavedMsg("Draft saved — safe to refresh or come back later.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  // Day-charter quotes two FINAL rates, so the fee/APA/VAT stop-flags do not
  // apply (the operator's day rate is the price; no breakdown to resolve).
  const stopFlags = priceMode === "day_charter"
    ? []
    : (ex?.flags || []).filter((f) => STOP_CODES.has(f.code) && !(priceMode === "all_inclusive" && (f.code === "MISSING_APA" || f.code === "MISSING_VAT")));
  const warnFlags = (ex?.flags || []).filter((f) => !STOP_CODES.has(f.code));
  const allStopResolved = stopFlags.every((f) => resolved.has(f.code));
  const hasFee = priceMode === "day_charter"
    ? (Number(px.half_day_rate) > 0 || Number(px.full_day_rate) > 0)
    : priceMode === "all_inclusive" ? Number(px.all_inclusive_total) > 0 : (!!px.charter_fee.trim() || !!px.extras_text.trim());
  const canGenerate = !!ex && hasFee && allStopResolved && !!surname && mode !== "combined" && busy === null;

  async function runExtract() {
    setBusy("extract"); setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/extract`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "extract-failed");
      setEx(j.extraction);
      setPx(seedPrice(j.extraction));
      setPriceMode(j.extraction?.suggested_mode || "breakdown");
      setVessel({
        name: j.extraction?.vessel_name?.value || "",
        type: j.extraction?.vessel_type?.value || "",
        spec_line: j.extraction?.spec_line?.value || "",
        period_line: "", price_sub: "",
        embarkation: j.extraction?.embarkation?.value || "",
        disembarkation: j.extraction?.disembarkation?.value || "",
        date_from: j.extraction?.dates?.from?.value || "",
        date_to: j.extraction?.dates?.to?.value || "",
      });
      setResolved(new Set());
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function runGenerate() {
    if (!canGenerate) return;
    setBusy("generate"); setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "single",
          vessel: {
            name: vessel.name, type: vessel.type, spec_line: vessel.spec_line,
            period_line: vessel.period_line || undefined, price_sub: vessel.price_sub || undefined,
            embarkation: vessel.embarkation || undefined, disembarkation: vessel.disembarkation || undefined,
            date_from: vessel.date_from || undefined, date_to: vessel.date_to || undefined,
            gallery_slots: 4,
          },
          pricing: pricingOf(px, priceMode),
          content: ex?.content || {},
          details: [],
          white_label: whiteLabel,
          charter_type: charterType,
          crew_note: crewNote,
          terms: termsObjectFromState(terms) ?? null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "generate-failed");
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <section style={card}>
      <div style={cardLabel}>Generate proposal</div>

      {/* Already generated: show the current PDF + email for a final check, but
          KEEP the editable review below so the broker can revise and regenerate. */}
      {pdfPath && (
        <div style={generatedBanner}>
          <div style={{ fontSize: 12.5, color: "#1f2937", marginBottom: 8 }}>
            <b>Proposal generated.</b> Open it for a final check, edit below, then press <b>Generate</b> at the bottom to update it.
          </div>
          <a href={`/api/helm/${requestId}/proposal-pdf`} target="_blank" rel="noreferrer" style={pdfLink}>Open current PDF ↗</a>
          {!isAgent && (
            <label style={wlToggle}>
              <input type="checkbox" checked={whiteLabel} onChange={(e) => setWhiteLabel(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                <span style={{ fontSize: 12.5, color: "#1f2937", fontWeight: 600 }}>White-label this PDF (remove all George Yachts identity — for forwarding)</span>
                <span style={{ display: "block", fontSize: 11.5, color: "#9CA3AF", marginTop: 2 }}>Re-press Generate below to apply. Logos and George-voice copy are stripped; the agent/client can forward it as their own.</span>
              </span>
            </label>
          )}
          {emailSubject && (<div style={{ marginTop: 12 }}><div style={fieldLabel}>Email subject</div><div style={{ fontSize: 14, color: "#1f2937", marginTop: 2 }}>{emailSubject}</div></div>)}
          {emailIntro && (<div style={{ marginTop: 10 }}><div style={fieldLabel}>Email body</div><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.55, color: "#1f2937", marginTop: 4, background: "rgba(13,27,42,0.03)", padding: 12 }}>{emailIntro}</pre></div>)}
        </div>
      )}

      {!hasSupplier && <p style={{ fontSize: 13, color: "#9CA3AF", fontStyle: "italic" }}>Paste the supplier email on this request first, then extract.</p>}

      {!ex && hasSupplier && (
        <button type="button" onClick={runExtract} disabled={busy !== null} style={primaryBtn}>
          {busy === "extract" ? "Extracting…" : "Extract numbers from supplier email"}
        </button>
      )}

      {ex && (
        <>
          {mode === "combined" && (
            <div style={warnBox}>Combined multi-yacht auto-generate is the next step. Switch this request to single mode to generate now.</div>
          )}

          {/* STOP flags — block generate until each is resolved */}
          {stopFlags.length > 0 && (
            <div style={stopBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>STOP · do not generate until resolved</div>
              {stopFlags.map((f) => (
                <label key={f.code} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={resolved.has(f.code)}
                    onChange={(e) => {
                      const next = new Set(resolved);
                      if (e.target.checked) next.add(f.code); else next.delete(f.code);
                      setResolved(next);
                    }}
                  />
                  <span style={{ fontSize: 13 }}><b>{f.code}</b> — {f.message} <i>(tick once you have confirmed the correct number below)</i></span>
                </label>
              ))}
            </div>
          )}

          {warnFlags.length > 0 && (
            <div style={warnBox}>
              {warnFlags.map((f) => <div key={f.code} style={{ fontSize: 12.5 }}><b>{f.code}</b> — {f.message}</div>)}
            </div>
          )}

          {/* seasonal rates — click to set the charter fee, or split by day across seasons */}
          {ex.seasonal_rates?.length > 0 && priceMode !== "day_charter" && (
            <div style={{ margin: "12px 0" }}>
              <div style={fieldLabel}>Seasonal rates found — pick the one for these dates, or split by day if it spans seasons</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {ex.seasonal_rates.map((s, i) => (
                  <button key={i} type="button" onClick={() => setPx({ ...px, charter_fee: String(s.fee) })} style={chipBtn}>
                    {s.label}: € {s.fee.toLocaleString("en-US")}
                  </button>
                ))}
              </div>
              <SeasonProration
                rates={ex.seasonal_rates}
                onApply={(total) => setPx({ ...px, charter_fee: String(total) })}
              />
            </div>
          )}

          {/* CHARTER TYPE selector — rewrites the boilerplate + money box. Weekly
              (default) = the existing crewed-weekly proposal, unchanged. */}
          <div style={{ marginTop: 12 }}>
            <div style={fieldLabel}>Charter type</div>
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

          {/* pricing MODE selector (per yacht) */}
          <div style={{ marginTop: 12 }}>
            <div style={fieldLabel}>Pricing mode</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              {([["breakdown", "Breakdown (fee + APA% + VAT%)"], ["plus_extras", "Plus extras"], ["all_inclusive", "All-inclusive"], ["day_charter", "Day charter"]] as const).map(([m, label]) => (
                <button key={m} type="button" onClick={() => setPriceMode(m)} style={{
                  ...chipBtn,
                  background: priceMode === m ? "#0D1B2A" : "rgba(201,168,76,0.12)",
                  color: priceMode === m ? "#F8F5F0" : "#0D1B2A",
                }}>{label}</button>
              ))}
            </div>
          </div>

          {/* numbers — every value editable beside its exact supplier snippet */}
          <div style={{ marginTop: 12 }}>
            <div style={fieldLabel}>Confirm each number against its supplier snippet</div>
            {priceMode === "day_charter" ? (
              <>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 6 }}>
                  Two FINAL, all-in day rates. Enter either or both — the proposal shows exactly what you set (half day / full day). No APA or VAT is added.
                </div>
                <div style={priceRow}>
                  <input value={px.half_day_label ?? ""} onChange={(e) => setPx({ ...px, half_day_label: e.target.value })} placeholder="Half day (5h)" style={{ ...priceInput, width: 130 }} />
                  <input value={px.half_day_rate ?? ""} onChange={(e) => setPx({ ...px, half_day_rate: e.target.value })} placeholder="e.g. 1500" style={priceInput} />
                  <span style={{ width: 52 }} />
                  <div style={snippetStyle}>Final half-day price (EUR)</div>
                </div>
                <div style={priceRow}>
                  <input value={px.full_day_label ?? ""} onChange={(e) => setPx({ ...px, full_day_label: e.target.value })} placeholder="Full day (8h)" style={{ ...priceInput, width: 130 }} />
                  <input value={px.full_day_rate ?? ""} onChange={(e) => setPx({ ...px, full_day_rate: e.target.value })} placeholder="e.g. 2500" style={priceInput} />
                  <span style={{ width: 52 }} />
                  <div style={snippetStyle}>Final full-day price (EUR)</div>
                </div>
              </>
            ) : priceMode === "all_inclusive" ? (
              <div style={priceRow}>
                <div style={{ width: 130, fontSize: 12.5, color: "#374151" }}>All-inclusive total (EUR)</div>
                <input
                  value={px.all_inclusive_total ?? ""}
                  onChange={(e) => setPx({ ...px, all_inclusive_total: e.target.value })}
                  placeholder="e.g. 200000"
                  style={priceInput}
                />
                {ex.pricing?.all_inclusive_total?.confidence ? <ConfBadge c={ex.pricing.all_inclusive_total.confidence} /> : <span style={{ width: 52 }} />}
                <div style={snippetStyle}>{ex.pricing?.all_inclusive_total?.snippet ? `“${ex.pricing.all_inclusive_total.snippet}”` : <span style={{ color: "#cbd5e1" }}>no snippet</span>}</div>
              </div>
            ) : (
              <>
                {PRICE_FIELDS.map(({ key, label }) => {
                  const fld = ex.pricing?.[key];
                  return (
                    <div key={key} style={priceRow}>
                      <div style={{ width: 130, fontSize: 12.5, color: "#374151" }}>{label}</div>
                      <input value={px[key] ?? ""} onChange={(e) => setPx({ ...px, [key]: e.target.value })} placeholder="-" style={priceInput} />
                      {fld?.value !== null && fld?.value !== undefined && fld?.confidence ? <ConfBadge c={fld.confidence} /> : <span style={{ width: 52 }} />}
                      <div style={snippetStyle}>{fld?.snippet ? `“${fld.snippet}”` : <span style={{ color: "#cbd5e1" }}>no snippet</span>}</div>
                    </div>
                  );
                })}
                <div style={priceRow}>
                  <div style={{ width: 130, fontSize: 12.5, color: "#374151" }}>Plus-extras text</div>
                  <input value={px.extras_text} onChange={(e) => setPx({ ...px, extras_text: e.target.value })} placeholder="e.g. plus expenses (only if no APA/VAT)" style={{ ...priceInput, width: 280 }} />
                  <span style={{ width: 52 }} />
                  <div style={snippetStyle}>{ex.pricing?.extras_text?.snippet ? `“${ex.pricing.extras_text.snippet}”` : ""}</div>
                </div>
              </>
            )}
          </div>

          {/* owner discount / relocation / rounding + live preview (breakdown only) */}
          {priceMode === "breakdown" && (
            <PricingExtras
              pricing={pricingOf(px, priceMode)}
              discount={px.discount_pct}
              relocation={px.relocation_fee}
              override={px.all_in_override}
              onChange={(k, v) => setPx({ ...px, [k]: v })}
            />
          )}

          {/* vessel facts (editable) */}
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Labeled label="Vessel name"><input value={vessel.name} onChange={(e) => setVessel({ ...vessel, name: e.target.value })} style={txt} /></Labeled>
            <Labeled label="Type"><input value={vessel.type} onChange={(e) => setVessel({ ...vessel, type: e.target.value })} placeholder="MOTOR YACHT" style={txt} /></Labeled>
            <Labeled label="Spec line"><input value={vessel.spec_line} onChange={(e) => setVessel({ ...vessel, spec_line: e.target.value })} style={txt} /></Labeled>
            <Labeled label="Period line (optional)"><input value={vessel.period_line} onChange={(e) => setVessel({ ...vessel, period_line: e.target.value })} placeholder="auto from dates/area" style={txt} /></Labeled>
            <Labeled label="Embarkation"><input value={vessel.embarkation} onChange={(e) => setVessel({ ...vessel, embarkation: e.target.value })} placeholder="e.g. Athens" style={txt} /></Labeled>
            <Labeled label="Disembarkation"><input value={vessel.disembarkation} onChange={(e) => setVessel({ ...vessel, disembarkation: e.target.value })} placeholder="e.g. Mykonos" style={txt} /></Labeled>
            <Labeled label="Dates from"><input value={vessel.date_from} onChange={(e) => setVessel({ ...vessel, date_from: e.target.value })} placeholder="25 June" style={txt} /></Labeled>
            <Labeled label="Dates to"><input value={vessel.date_to} onChange={(e) => setVessel({ ...vessel, date_to: e.target.value })} placeholder="3 July" style={txt} /></Labeled>
          </div>

          {!surname && <div style={warnBox}>Add a client <b>surname</b> on this request first — proposals are addressed formally (never a bare first name).</div>}

          <button type="button" onClick={runGenerate} disabled={!canGenerate} style={{ ...primaryBtn, marginTop: 16, opacity: canGenerate ? 1 : 0.5, cursor: canGenerate ? "pointer" : "not-allowed" }}>
            {busy === "generate" ? "Generating…" : pdfPath ? "Regenerate proposal PDF" : "Generate proposal PDF"}
          </button>
          {!canGenerate && busy === null && (
            <div style={{ fontSize: 11.5, color: "#9CA3AF", marginTop: 6 }}>
              {stopFlags.length > 0 && !allStopResolved ? "Resolve every STOP flag above. " : ""}
              {!hasFee ? "Set a charter fee (or plus-extras). " : ""}
              {!surname ? "Add a client surname. " : ""}
              {mode === "combined" ? "Switch to single mode. " : ""}
            </div>
          )}
          <button type="button" onClick={saveDraft} disabled={busy !== null} style={{ ...ghostBtn, marginTop: 10, marginRight: 8 }}>
            {busy === "savedraft" ? "Saving…" : "Save draft"}
          </button>
          <button type="button" onClick={runExtract} disabled={busy !== null} style={{ ...ghostBtn, marginTop: 10 }}>
            {busy === "extract" ? "Re-extracting…" : "Re-extract from supplier email"}
          </button>
        </>
      )}

      {savedMsg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 8 }}>{savedMsg}</p>}
      {error && <p style={errStyle}>{error}</p>}
    </section>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "block" }}><div style={fieldLabel}>{label}</div><div style={{ marginTop: 4 }}>{children}</div></label>;
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 };
const fieldLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" };
const primaryBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "8px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const chipBtn: React.CSSProperties = { background: "rgba(201,168,76,0.12)", color: "#0D1B2A", border: "1px solid #C9A84C", padding: "6px 12px", fontSize: 12, cursor: "pointer" };
const priceRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "5px 0" };
const priceInput: React.CSSProperties = { width: 120, padding: 7, border: "1px solid rgba(13,27,42,0.2)", fontSize: 13, fontFamily: "inherit" };
const snippetStyle: React.CSSProperties = { flex: 1, fontSize: 12, color: "#6b7280", fontStyle: "italic" };
const txt: React.CSSProperties = { width: "100%", padding: 8, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit" };
const stopBox: React.CSSProperties = { background: "rgba(177,74,58,0.08)", border: "1px solid rgba(177,74,58,0.5)", color: "#7f1d1d", padding: "10px 12px", margin: "12px 0", fontSize: 13 };
const warnBox: React.CSSProperties = { background: "rgba(176,122,44,0.08)", border: "1px solid rgba(176,122,44,0.4)", color: "#7c4a03", padding: "8px 12px", margin: "10px 0", fontSize: 12.5 };
const pdfLink: React.CSSProperties = { display: "inline-block", background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", textDecoration: "none", fontSize: 10, letterSpacing: 2, textTransform: "uppercase" };
const generatedBanner: React.CSSProperties = { background: "rgba(58,107,71,0.07)", border: "1px solid rgba(58,107,71,0.35)", padding: "12px 14px", margin: "10px 0 14px", borderRadius: 2 };
const wlToggle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, padding: "10px 12px", background: "#fff", border: "1px solid rgba(13,27,42,0.12)", borderRadius: 2, cursor: "pointer" };
const errStyle: React.CSSProperties = { color: "#b91c1c", fontSize: 12, marginTop: 8 };
