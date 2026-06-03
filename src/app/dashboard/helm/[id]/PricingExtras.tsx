"use client";

// Shared review widget (both Direct Client + Travel Agent, single + combined):
// owner discount, relocation fee, optional total-rounding, and a LIVE preview of
// the exact breakdown so the broker sees every figure before generating. All
// math is computePricing (pricing.ts) - the same engine the PDF uses, so the
// preview is exactly what ships. To round APA/VAT the broker edits their amount
// in the main price fields; to round the final total he uses "Round total".

import { computePricing, type PricingInput } from "@/lib/helm/pricing";

export default function PricingExtras({
  pricing, discount, relocation, override, onChange,
}: {
  pricing: PricingInput;
  discount: string;
  relocation: string;
  override: string;
  onChange: (k: "discount_pct" | "relocation_fee" | "all_in_override", v: string) => void;
}) {
  const pr = computePricing(pricing);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={lbl}>Owner discount · relocation · rounding (optional)</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
        <Field label="Owner discount %" value={discount} placeholder="e.g. 5" onChange={(v) => onChange("discount_pct", v)} />
        <Field label="Relocation fee €" value={relocation} placeholder="e.g. 3360" onChange={(v) => onChange("relocation_fee", v)} />
        <Field label="Round total € (optional)" value={override} placeholder="blank = exact" onChange={(v) => onChange("all_in_override", v)} />
      </div>

      <div style={previewBox}>
        <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF", marginBottom: 5 }}>Live preview (exactly what the PDF shows)</div>
        <div style={prow}><span>Charter Fee</span><span>{pr.charter_fee_disp || "—"}</span></div>
        {pr.discount_note && <div style={{ color: "#B07A2C", fontWeight: 600, fontSize: 12, margin: "2px 0" }}>{pr.discount_note}</div>}
        {pr.rows.map(([l, a], i) => (
          <div key={i} style={prow}><span>{l}</span><span>{a}</span></div>
        ))}
        {pr.all_in && (
          <div style={{ ...prow, borderTop: "1px solid rgba(13,27,42,0.18)", marginTop: 5, paddingTop: 5, fontWeight: 700, color: "#0D1B2A" }}>
            <span>{pr.all_inclusive ? "All-inclusive" : "Estimated all-in total"}</span><span>{pr.all_in}</span>
          </div>
        )}
        {pr.per_person_4 && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>Per guest: {pr.per_person_4} (4) · {pr.per_person_6} (6)</div>}
        <div style={{ fontSize: 10.5, color: "#9CA3AF", marginTop: 5, fontStyle: "italic" }}>
          Round APA/VAT by editing their amount in the fields above; round the final total with &quot;Round total&quot;.
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#9CA3AF" }}>{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="decimal"
        style={{ width: 150, padding: 7, border: "1px solid rgba(13,27,42,0.2)", fontSize: 13, fontFamily: "inherit", marginTop: 3 }} />
    </label>
  );
}

const lbl: React.CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" };
const previewBox: React.CSSProperties = { border: "1px solid rgba(13,27,42,0.12)", background: "rgba(201,168,76,0.06)", padding: "8px 12px", marginTop: 10, borderRadius: 2 };
const prow: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#374151", padding: "2px 0" };
