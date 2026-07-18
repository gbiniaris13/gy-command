"use client";

// The two-phase yacht picker (2026-07-18, George's design): paste a supplier
// email as-is → it lists ONLY the yacht titles → George ticks the ones he wants
// → it extracts full detail for just those and adds them to the proposal. Then
// he pastes the next supplier's email and repeats. No more pulling in 26 yachts
// to hand-exclude 20, and no truncation crash on a long multi-yacht email.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Scanned = { name: string; line: string; snippet: string };

export default function SupplierYachtPicker({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [scanned, setScanned] = useState<Scanned[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | "scan" | "add">(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function scan() {
    if (!text.trim()) return;
    setBusy("scan"); setErr(null); setMsg(null); setScanned(null); setPicked(new Set());
    try {
      const r = await fetch(`/api/helm/${requestId}/scan-yachts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "scan failed");
      setScanned(j.yachts as Scanned[]);
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
    if (!scanned || picked.size === 0) return;
    setBusy("add"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/extract-picked`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, names: [...picked] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "add failed");
      setMsg(`Added ${j.added} yacht${j.added === 1 ? "" : "s"} (${j.total} in the proposal). Paste the next supplier email below, or scroll down to price them.`);
      setText(""); setScanned(null); setPicked(new Set());
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <section style={card}>
      <div style={cardLabel}>Add yachts from a supplier email</div>
      <p style={{ fontSize: 12.5, color: "#6b7280", lineHeight: 1.6, margin: "0 0 10px" }}>
        Paste one supplier&apos;s email as it is. You will see just the yacht names, tick the ones you want, and only those are added. Then paste the next supplier and repeat.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Paste the supplier email here (all 12 yachts is fine — you pick after)."
        style={{ width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 }}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
        <button type="button" onClick={scan} disabled={busy !== null || !text.trim()} style={primaryBtn}>
          {busy === "scan" ? "Reading the yachts…" : "Scan for yachts"}
        </button>
        {msg && <span style={{ fontSize: 12.5, color: "#3A6B47" }}>{msg}</span>}
        {err && <span style={{ fontSize: 12.5, color: "#b91c1c" }}>{err}</span>}
      </div>

      {scanned && scanned.length > 0 && (
        <div style={{ marginTop: 14, border: "1px solid rgba(201,168,76,0.35)", borderRadius: 2, background: "rgba(201,168,76,0.05)", padding: "12px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#6b7280", fontWeight: 700 }}>
              {scanned.length} yacht{scanned.length === 1 ? "" : "s"} in this email · tick the ones you want
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
              {busy === "add" ? "Adding…" : `Add ${picked.size || ""} selected yacht${picked.size === 1 ? "" : "s"}`}
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
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "7px 12px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer" };
