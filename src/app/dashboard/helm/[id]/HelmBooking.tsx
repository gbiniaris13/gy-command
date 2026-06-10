"use client";

// The Helm — WON next steps. Once a charter is agreed, George names the chosen
// yacht and gets two ready drafts: the MYBA contract request to the central
// agency, and a short confirmation to the client/agent. Copy and send from his
// inbox (or via the agency emailer above). No auto-send.

import { useState } from "react";

export default function HelmBooking({ requestId }: { requestId: string }) {
  const [yacht, setYacht] = useState("");
  const [agency, setAgency] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    if (!yacht.trim()) { setErr("Type the chosen yacht first."); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/booking`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", chosen_yacht: yacht.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "generate-failed");
      setAgency(j.agency_request || "");
      setConfirmation(j.confirmation || "");
      setMsg("Drafts ready. Review, copy, and send each from your inbox.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function copy(t: string) {
    try { await navigator.clipboard.writeText(t); setMsg("Copied."); }
    catch { setMsg("Select the text and copy manually."); }
  }

  return (
    <section style={{ ...card, borderColor: "rgba(58,107,71,0.35)", background: "rgba(58,107,71,0.05)" }}>
      <div style={cardLabel}>Won · booking next steps</div>
      <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 10 }}>
        Which yacht did they choose? You will get the MYBA contract request to the central agency and a confirmation to send.
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input value={yacht} onChange={(e) => setYacht(e.target.value)} placeholder="Chosen yacht, e.g. PI2" style={input} />
        <button type="button" onClick={generate} disabled={busy} style={primaryBtn}>
          {busy ? "Generating…" : "Generate next steps"}
        </button>
      </div>

      {agency && (
        <div style={{ marginTop: 14 }}>
          <label style={fieldLabel}>1 · MYBA contract request — to the central agency</label>
          <textarea value={agency} onChange={(e) => setAgency(e.target.value)} rows={9} style={textarea} />
          <button type="button" onClick={() => copy(agency)} style={ghostBtn}>Copy</button>
        </div>
      )}
      {confirmation && (
        <div style={{ marginTop: 14 }}>
          <label style={fieldLabel}>2 · Confirmation — to the client / agent</label>
          <textarea value={confirmation} onChange={(e) => setConfirmation(e.target.value)} rows={7} style={textarea} />
          <button type="button" onClick={() => copy(confirmation)} style={ghostBtn}>Copy</button>
        </div>
      )}

      {msg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 10 }}>{msg}</p>}
      {err && <p style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 10 }}>{err}</p>}
    </section>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 };
const fieldLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF", display: "block", marginBottom: 4 };
const input: React.CSSProperties = { flex: "1 1 220px", padding: 9, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit" };
const textarea: React.CSSProperties = { width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", marginTop: 4, marginBottom: 8, lineHeight: 1.5 };
const primaryBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "8px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
