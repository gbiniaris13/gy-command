"use client";

// The Helm — COMBINED multi-yacht review + generate. One card per yacht, each
// with its OWN pricing mode, numbers (beside their verbatim supplier snippet +
// confidence), STOP flags, and photo. Generate is DISABLED until EVERY yacht
// has its required figure set + all its STOP flags resolved, and the client
// surname is present. The route computes each yacht in code, sorts the
// shortlist cheapest -> priciest by all-in, and assembles ONE combined PDF.

import { useState } from "react";
import { useRouter } from "next/navigation";
import SeasonProration from "./SeasonProration";
import PricingExtras from "./PricingExtras";
import type { PricingInput } from "@/lib/helm/pricing";

type Confidence = "high" | "medium" | "low";
type Field<T> = { value: T | null; confidence: Confidence; snippet: string };
type YachtExtraction = {
  vessel_name: Field<string>;
  vessel_type: Field<string>;
  spec_line: Field<string>;
  pricing: Record<string, Field<number | string>>;
  seasonal_rates: { label: string; fee: number; snippet: string }[];
  dates?: { from?: Field<string>; to?: Field<string> };
  embarkation?: Field<string>;
  disembarkation?: Field<string>;
  content?: Record<string, unknown>;
  suggested_mode?: "breakdown" | "plus_extras" | "all_inclusive";
  flags: { code: string; message: string }[];
};
type CombinedExtraction = { yachts: YachtExtraction[] };
type MediaEntry = { main_url?: string; brochure_url?: string };
type PriceMode = "breakdown" | "plus_extras" | "all_inclusive";

type YState = {
  px: Record<string, string>;
  priceMode: PriceMode;
  resolved: string[];
  vessel: { name: string; type: string; spec_line: string; embarkation: string; disembarkation: string; date_from: string; date_to: string };
  /** Excluded from the proposal (e.g. the yacht got booked meanwhile). The card
   *  stays — nothing is deleted — it is simply left out of the generated PDF. */
  excluded?: boolean;
};

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
  const o: Record<string, string> = { charter_fee: "", apa_pct: "", apa_amount: "", vat_pct: "", vat_amount: "", extras_text: "", all_inclusive_total: "", discount_pct: "", relocation_fee: "", all_in_override: "", currency: "EUR" };
  if (y) for (const k of Object.keys(o)) {
    const v = y.pricing?.[k]?.value;
    if (v !== null && v !== undefined && v !== "") o[k] = String(v);
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
  initialDraft: { mode?: string; yachts?: YState[] } | null;
  isAgent: boolean;
  initialWhiteLabel: boolean;
}) {
  const router = useRouter();
  const [ex, setEx] = useState<CombinedExtraction | null>(initialExtraction);
  const [whiteLabel, setWhiteLabel] = useState(initialWhiteLabel);
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
        body: JSON.stringify({ review_draft: { mode: "combined", yachts: nextYs } }),
      });
      setSavedMsg(`Added ${addedCount} yacht${addedCount === 1 ? "" : "s"} from the new supplier. Your earlier yachts are untouched — review the new cards, then ${pdfPath ? "Regenerate" : "Generate"}.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function saveDraft() {
    setBusy("savedraft"); setError(null); setSavedMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_draft: { mode: "combined", yachts: ys } }),
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
    return (y.flags || []).filter((f) => STOP_CODES.has(f.code) && !(mode === "all_inclusive" && (f.code === "MISSING_APA" || f.code === "MISSING_VAT")));
  }
  function hasFee(i: number): boolean {
    const s = ys[i]; if (!s) return false;
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
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function runGenerate() {
    if (!canGenerate || !ex) return;
    setBusy("generate"); setError(null);
    try {
      const payload = {
        mode: "combined",
        white_label: whiteLabel,
        // Excluded yachts are left out of the PDF. media_index = the ORIGINAL
        // card index, so each remaining yacht keeps ITS OWN photos/brochure
        // server-side even when an earlier card is excluded.
        yachts: ex.yachts
          .map((y, i) => ({ y, s: ys[i], i }))
          .filter(({ s }) => s && !s.excluded)
          .map(({ y, s, i }) => ({
            media_index: i,
            vessel: { name: s.vessel.name, type: s.vessel.type, spec_line: s.vessel.spec_line, embarkation: s.vessel.embarkation, disembarkation: s.vessel.disembarkation, date_from: s.vessel.date_from, date_to: s.vessel.date_to },
            pricing: pricingOf(s.px, s.priceMode),
            content: y.content || {},
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

  // ---- per-yacht media ----
  async function uploadPhoto(i: number, file: File) {
    setBusy(`media-${i}`); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("kind", "photo"); fd.append("yacht_index", String(i));
      const r = await fetch(`/api/helm/${requestId}/upload-media`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "upload-failed");
      if (j.configured === false) { setError(j.message || "Cloudinary not connected. Paste an image link instead."); return; }
      if (j.combined_media) setMedia(j.combined_media);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  // Upload a brochure PDF for one yacht — same endpoint as photos (kind:
  // brochure); the route stores it as raw .pdf on Cloudinary and saves the
  // public URL into this yacht's combined_media slot.
  async function uploadBrochure(i: number, file: File) {
    setBusy(`media-${i}`); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("kind", "brochure"); fd.append("yacht_index", String(i));
      const r = await fetch(`/api/helm/${requestId}/upload-media`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "upload-failed");
      if (j.configured === false) { setError(j.message || "Cloudinary not connected. Paste a brochure link instead."); return; }
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
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "link-failed");
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
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "remove-failed");
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
                      <span style={{ fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#F8F5F0", background: "#0D1B2A", padding: "2px 7px", borderRadius: 2 }}>Lead</span>
                    )}
                    <span style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: s.excluded ? "#9CA3AF" : ready ? "#3A6B47" : "#B07A2C" }}>
                      {s.excluded ? "excluded from proposal" : ready ? "ready ✓" : "needs review"}
                    </span>
                    {!s.excluded && (
                      <button
                        type="button"
                        onClick={() => toggleFeature(i)}
                        disabled={busy !== null}
                        title={featuredIdx === i ? "Unpin — return to the cheapest→priciest order" : "Pin as the lead — goes on the cover and first; the rest keep the price order"}
                        style={{ ...ghostBtn, padding: "5px 10px", fontSize: 9, ...(featuredIdx === i ? { background: "#0D1B2A", color: "#F8F5F0", borderColor: "#C9A84C" } : {}) }}
                      >
                        {busy === `feat-${i}` ? "…" : featuredIdx === i ? "Lead ✓ — click to unpin" : "Make lead"}
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

                {/* seasonal rates: pick one (whole charter in one season), or split by day across seasons */}
                {y.seasonal_rates?.length > 0 && (
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
                    {([["breakdown", "Breakdown"], ["plus_extras", "Plus extras"], ["all_inclusive", "All-inclusive"]] as const).map(([mm, label]) => (
                      <button key={mm} type="button" onClick={() => patchY(i, { priceMode: mm })} style={{ ...chipBtn, background: s.priceMode === mm ? "#0D1B2A" : "rgba(201,168,76,0.12)", color: s.priceMode === mm ? "#F8F5F0" : "#0D1B2A" }}>{label}</button>
                    ))}
                  </div>
                </div>

                {/* numbers + snippets */}
                <div style={{ marginTop: 10 }}>
                  {s.priceMode === "all_inclusive" ? (
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
              </div>
            );
          })}

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
const stopBox: React.CSSProperties = { background: "rgba(177,74,58,0.08)", border: "1px solid rgba(177,74,58,0.5)", color: "#7f1d1d", padding: "8px 10px", margin: "10px 0", fontSize: 13 };
const warnBox: React.CSSProperties = { background: "rgba(176,122,44,0.08)", border: "1px solid rgba(176,122,44,0.4)", color: "#7c4a03", padding: "8px 12px", margin: "10px 0", fontSize: 12.5 };
const pdfLink: React.CSSProperties = { display: "inline-block", background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", textDecoration: "none", fontSize: 10, letterSpacing: 2, textTransform: "uppercase" };
const generatedBanner: React.CSSProperties = { background: "rgba(58,107,71,0.07)", border: "1px solid rgba(58,107,71,0.35)", padding: "12px 14px", margin: "10px 0 14px", borderRadius: 2 };
const wlToggle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, padding: "10px 12px", background: "#fff", border: "1px solid rgba(13,27,42,0.12)", borderRadius: 2, cursor: "pointer" };
const emailPre: React.CSSProperties = { whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.55, color: "#1f2937", marginTop: 4, background: "rgba(13,27,42,0.03)", padding: 12 };
const errStyle: React.CSSProperties = { color: "#b91c1c", fontSize: 12, marginTop: 8 };
