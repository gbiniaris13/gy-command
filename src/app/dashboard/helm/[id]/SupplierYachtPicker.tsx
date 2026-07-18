"use client";

// The two-phase yacht picker (2026-07-18, George's design): a supplier offers
// 12 yachts, he wants 6-7. It lists ONLY the yacht titles → George ticks the
// ones he wants → it extracts full detail (numbers + the brochure content that
// makes the magazine rich) for JUST those and adds them. Repeat per supplier.
//
// TWO sources: the supplier emails he already imported from Gmail (their
// brochures are already transcribed into the record — the primary path), OR a
// fresh pasted email. No more pulling in 26 yachts to hand-exclude 20, and no
// truncation crash on a long multi-yacht email.

import { useState } from "react";

type Scanned = { name: string; line: string; snippet: string };

export default function SupplierYachtPicker({ requestId, hasImported }: { requestId: string; hasImported: boolean }) {
  const [text, setText] = useState("");
  const [scanned, setScanned] = useState<Scanned[] | null>(null);
  const [source, setSource] = useState<"imported" | "pasted" | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | "imported" | "pasted" | "add">(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function scan(from: "imported" | "pasted") {
    if (from === "pasted" && !text.trim()) return;
    setBusy(from); setErr(null); setMsg(null); setScanned(null); setPicked(new Set());
    try {
      const r = await fetch(`/api/helm/${requestId}/scan-yachts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(from === "imported" ? { useImported: true } : { text }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "scan failed");
      setScanned(j.yachts as Scanned[]);
      setSource(from);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  function toggle(name: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  }
  const allPicked = !!scanned && scanned.length > 0 && picked.size === scanned.length;
  function toggleAll() {
    if (!scanned) return;
    setPicked(allPicked ? new Set() : new Set(scanned.map((y) => y.name)));
  }

  async function add() {
    if (!scanned || picked.size === 0 || !source) return;
    setBusy("add"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/extract-picked`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(source === "imported" ? { useImported: true, names: [...picked] } : { text, names: [...picked] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "add failed");
      setMsg(`Added ${j.added} yacht${j.added === 1 ? "" : "s"} — loading the cards…`);
      // A full reload: adding the first yacht flips the request to combined mode,
      // and the yacht-cards panel is a client component seeded once on mount, so
      // router.refresh() alone would not show the new cards. Reload re-mounts it.
      setTimeout(() => window.location.reload(), 700);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <section style={card}>
      <div style={cardLabel}>Add yachts from a supplier email</div>
      <p style={{ fontSize: 12.5, color: "#6b7280", lineHeight: 1.6, margin: "0 0 12px" }}>
        See the yacht names, tick the ones you want, and only those are added - with their brochure detail read in for the magazine. Repeat per supplier.
      </p>

      {hasImported && (
        <div style={{ marginBottom: 12 }}>
          <button type="button" onClick={() => scan("imported")} disabled={busy !== null} style={primaryBtn}>
            {busy === "imported" ? "Reading the yachts + brochures…" : "Scan the supplier emails I imported"}
          </button>
          <span style={{ marginLeft: 10, fontSize: 11.5, color: "#9CA3AF" }}>reads the brochures already imported from Gmail</span>
        </div>
      )}

      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#cbd5e1", margin: "4px 0 6px" }}>
        {hasImported ? "or paste another supplier email" : "paste the supplier email"}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Paste a supplier email here (all 12 yachts is fine - you pick after)."
        style={{ width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 }}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => scan("pasted")} disabled={busy !== null || !text.trim()} style={ghostBtn}>
          {busy === "pasted" ? "Reading…" : "Scan pasted email"}
        </button>
        {msg && <span style={{ fontSize: 12.5, color: "#3A6B47" }}>{msg}</span>}
        {err && <span style={{ fontSize: 12.5, color: "#b91c1c" }}>{err}</span>}
      </div>

      {scanned && scanned.length > 0 && (
        <div style={{ marginTop: 14, border: "1px solid rgba(201,168,76,0.35)", borderRadius: 2, background: "rgba(201,168,76,0.05)", padding: "12px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#6b7280", fontWeight: 700 }}>
              {scanned.length} yacht{scanned.length === 1 ? "" : "s"} found · tick the ones you want
            </span>
            <button type="button" onClick={toggleAll} style={{ ...ghostBtn, padding: "4px 10px", fontSize: 9 }}>
              {allPicked ? "Clear all" : "Select all"}
            </button>
          </div>
          {scanned.map((y) => (
            <label key={y.name} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", borderTop: "1px solid rgba(13,27,42,0.06)", cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(y.name)} onChange={() => toggle(y.name)} style={{ marginTop: 3 }} />
              <span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#0D1B2A" }}>{y.name}</span>
                {y.line && <span style={{ display: "block", fontSize: 12, color: "#6b7280", marginTop: 1 }}>{y.line}</span>}
              </span>
            </label>
          ))}
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={add} disabled={busy !== null || picked.size === 0} style={{ ...primaryBtn, opacity: picked.size === 0 ? 0.5 : 1 }}>
              {busy === "add" ? "Adding + reading brochures…" : `Add ${picked.size || ""} selected yacht${picked.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 };
const primaryBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "9px 14px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer" };
