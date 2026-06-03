"use client";

// Split-season proration calculator (broker method). When a yacht is quoted
// with seasonal weekly rates and the charter straddles a season boundary, the
// broker turns each weekly rate into a daily rate (weekly / 7, rounded) and
// charters the days in each season separately. Example:
//   June 19,000/wk -> 2,700/day x 5 + July 21,000/wk -> 3,000/day x 2 = 19,500.
// All arithmetic is in pricing.ts (suggestDailyRate / prorateSeasonsTotal).
// The broker sets the daily rate + day count; pressing Apply writes the total
// into that yacht's charter fee. Single fixed rate -> this is never shown.

import { useState } from "react";
import { suggestDailyRate, prorateSeasonsTotal } from "@/lib/helm/pricing";

type Row = { label: string; weekly: number; daily: string; days: string };

export default function SeasonProration({
  rates, onApply,
}: {
  rates: { label: string; fee: number }[];
  onApply: (total: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(() =>
    rates.map((r) => ({ label: r.label, weekly: r.fee, daily: String(suggestDailyRate(r.fee)), days: "" })),
  );

  const set = (i: number, k: "daily" | "days", v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const totalDays = rows.reduce((s, r) => s + (Number(r.days) || 0), 0);
  const total = prorateSeasonsTotal(rows.map((r) => ({ daily: r.daily, days: r.days })));
  const fmt = (n: number) => "€ " + n.toLocaleString("en-US");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={linkBtn}>
        Spans two seasons? Split by day →
      </button>
    );
  }

  return (
    <div style={box}>
      <div style={{ fontSize: 11.5, color: "#374151", marginBottom: 8 }}>
        Daily = weekly ÷ 7 (rounded; edit if you round differently). A charter week is normally 7 days - allocate them across the seasons by the actual dates.
      </div>
      {rows.map((r, i) => (
        <div key={i} style={rowS}>
          <span style={{ flex: 1, fontSize: 12.5, color: "#1f2937" }}>{r.label}</span>
          <span style={{ fontSize: 12, color: "#6b7280", width: 110, textAlign: "right" }}>{fmt(r.weekly)}/wk</span>
          <label style={lbl}>day €
            <input value={r.daily} onChange={(e) => set(i, "daily", e.target.value)} inputMode="numeric" style={miniInput} />
          </label>
          <label style={lbl}>×
            <input value={r.days} onChange={(e) => set(i, "days", e.target.value)} inputMode="numeric" placeholder="days" style={{ ...miniInput, width: 48 }} />
          </label>
          <span style={{ width: 92, textAlign: "right", fontSize: 12.5, color: "#1f2937" }}>
            = {fmt((Number(r.daily) || 0) * (Number(r.days) || 0))}
          </span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 12, color: totalDays === 7 ? "#3A6B47" : "#B07A2C" }}>
          Total days: <b>{totalDays}</b>{totalDays !== 7 ? " (a charter week is usually 7)" : ""} · Charter fee: <b>{fmt(total)}</b>
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <button type="button" disabled={total <= 0} onClick={() => onApply(total)} style={{ ...applyBtn, opacity: total > 0 ? 1 : 0.5 }}>
            Use {fmt(total)} as charter fee
          </button>
          <button type="button" onClick={() => setOpen(false)} style={closeBtn}>Close</button>
        </span>
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "#0D1B2A", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: "4px 0", marginTop: 4 };
const box: React.CSSProperties = { border: "1px solid rgba(13,27,42,0.15)", background: "rgba(13,27,42,0.02)", padding: "10px 12px", marginTop: 8, borderRadius: 2 };
const rowS: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "3px 0", flexWrap: "wrap" };
const lbl: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#6b7280" };
const miniInput: React.CSSProperties = { width: 72, padding: 5, border: "1px solid rgba(13,27,42,0.2)", fontSize: 12.5, fontFamily: "inherit" };
const applyBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "6px 12px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer" };
const closeBtn: React.CSSProperties = { background: "#fff", color: "#6b7280", border: "1px solid rgba(13,27,42,0.2)", padding: "6px 10px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer" };
