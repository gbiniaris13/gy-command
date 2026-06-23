"use client";

// The Helm — OWNER-SELECTABLE last-page "Charter terms" editor. Proposal-level
// (one per PDF), collapsed by default, unobtrusive. One input per `terms` field:
// multiline textareas for the array fields (one item per line) and plain inputs
// for the string fields. Seeded from the persisted extraction.terms; when empty
// the parent MAY pre-fill smart suggestions by charter_type (the owner edits or
// clears them). The parent sends the assembled `terms` object in the generate
// POST body. Render rule lives in proposal-template.ts: only present sections
// show; an empty object falls back to the existing per-charter_type default.

import { useState } from "react";

export type TermsState = {
  included: string;            // textarea, one item per line
  not_included: string;
  obligatory_extras: string;
  free_onboard: string;
  security_deposit: string;    // single line
  payment: string;
  skipper: string;
  cancellation: string;
  notes: string;
};

export const EMPTY_TERMS: TermsState = {
  included: "", not_included: "", obligatory_extras: "", free_onboard: "",
  security_deposit: "", payment: "", skipper: "", cancellation: "", notes: "",
};

// Build the editor state from a persisted terms object (arrays -> newline text).
export function termsStateFromObject(t: unknown): TermsState {
  const o = (t && typeof t === "object") ? (t as Record<string, unknown>) : {};
  const lines = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "")).join("\n") : "");
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    included: lines(o.included),
    not_included: lines(o.not_included),
    obligatory_extras: lines(o.obligatory_extras),
    free_onboard: lines(o.free_onboard),
    security_deposit: str(o.security_deposit),
    payment: str(o.payment),
    skipper: str(o.skipper),
    cancellation: str(o.cancellation),
    notes: str(o.notes),
  };
}

// Convert the editor state into the `terms` object for the generate POST body.
// Splits textareas on newlines (trimmed, empties dropped). Returns undefined when
// nothing is set, so the last page falls back to the existing default text.
export function termsObjectFromState(s: TermsState): Record<string, unknown> | undefined {
  const arr = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
  const str = (v: string) => v.trim();
  const out: Record<string, unknown> = {};
  const a = (k: string, v: string[]) => { if (v.length) out[k] = v; };
  const t = (k: string, v: string) => { if (v) out[k] = v; };
  a("included", arr(s.included));
  a("not_included", arr(s.not_included));
  a("obligatory_extras", arr(s.obligatory_extras));
  a("free_onboard", arr(s.free_onboard));
  t("security_deposit", str(s.security_deposit));
  t("payment", str(s.payment));
  t("skipper", str(s.skipper));
  t("cancellation", str(s.cancellation));
  t("notes", str(s.notes));
  return Object.keys(out).length ? out : undefined;
}

// True when any field has content.
export function termsStateHasContent(s: TermsState): boolean {
  return Object.values(s).some((v) => v.trim());
}

const ARRAY_FIELDS: [keyof TermsState, string, string][] = [
  ["included", "What is included", "Use of the yacht and her equipment\nMarine insurance\nVAT 12% (included)"],
  ["not_included", "Not included", "Fuel\nPort fees\nFood & beverages"],
  ["obligatory_extras", "Payable at base / obligatory extras", "Charter Pack EUR 250 — end cleaning, linen & towels"],
  ["free_onboard", "Complimentary on board", "1 SUP\nSnorkelling equipment"],
];
const STRING_FIELDS: [keyof TermsState, string, string][] = [
  ["security_deposit", "Security deposit", "EUR 3,000 refundable, payable at base by card"],
  ["payment", "Payment", "50% within 5 days of booking; balance 30 days before embarkation"],
  ["skipper", "Skipper", "Skipper licence required; professional skipper on request"],
  ["cancellation", "Cancellation", "Free text"],
  ["notes", "Notes", "Any extra free text"],
];

export default function TermsEditor({
  value, onChange,
}: {
  value: TermsState;
  onChange: (next: TermsState) => void;
}) {
  const [open, setOpen] = useState(false);
  const has = termsStateHasContent(value);
  const set = (k: keyof TermsState, v: string) => onChange({ ...value, [k]: v });

  return (
    <div style={wrap}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={head}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{open ? "▾" : "▸"}</span>
          <span>Charter terms (last page)</span>
          {has && <span style={badge}>set</span>}
        </span>
        <span style={{ fontSize: 11, color: "#9CA3AF", textTransform: "none", letterSpacing: 0 }}>
          {open ? "optional · only filled-in sections appear" : "optional"}
        </span>
      </button>

      {open && (
        <div style={{ padding: "10px 12px 12px" }}>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 10, lineHeight: 1.5 }}>
            These drive the proposal&apos;s final &ldquo;Key Information&rdquo; page. Leave a field blank to hide that
            section. Leave everything blank to keep the standard wording for the chosen charter type. One item per line
            for the lists.
          </div>
          {ARRAY_FIELDS.map(([k, label, ph]) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div style={fieldLabel}>{label}</div>
              <textarea
                value={value[k]}
                onChange={(e) => set(k, e.target.value)}
                rows={3}
                placeholder={ph}
                style={ta}
              />
            </div>
          ))}
          {STRING_FIELDS.map(([k, label, ph]) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div style={fieldLabel}>{label}</div>
              <input value={value[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} style={inp} />
            </div>
          ))}
          {has && (
            <button type="button" onClick={() => onChange({ ...EMPTY_TERMS })} style={clearBtn}>
              Clear all terms
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = { marginTop: 12, border: "1px solid rgba(13,27,42,0.12)", borderRadius: 2, background: "rgba(13,27,42,0.015)" };
const head: React.CSSProperties = { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "10px 12px", background: "transparent", border: "none", cursor: "pointer", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#0D1B2A", fontWeight: 600 };
const badge: React.CSSProperties = { fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#F8F5F0", background: "#3A6B47", padding: "1px 6px", borderRadius: 2 };
const fieldLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF", marginBottom: 4 };
const ta: React.CSSProperties = { width: "100%", padding: 8, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 };
const inp: React.CSSProperties = { width: "100%", padding: 8, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit" };
const clearBtn: React.CSSProperties = { background: "#fff", color: "#7f1d1d", border: "1px solid rgba(177,74,58,0.4)", padding: "6px 12px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", marginTop: 2 };
