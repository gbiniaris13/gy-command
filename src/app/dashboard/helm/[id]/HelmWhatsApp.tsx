"use client";

// The Helm — a short WhatsApp nudge to drop after emailing the proposal. Generates
// a casual 1-2 line message; George copies it or taps "Open WhatsApp" which opens
// the chat (wa.me) with the text prefilled. Nothing is sent automatically.

import { useState } from "react";

export default function HelmWhatsApp({
  requestId, clientWhatsapp,
}: {
  requestId: string;
  clientWhatsapp: string | null;
}) {
  const [text, setText] = useState("");
  const [waLog, setWaLog] = useState("");
  const [logMsg, setLogMsg] = useState<string | null>(null);
  async function saveWaLog() {
    if (!waLog.trim()) return;
    setLogMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/whatsapp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "log", text: waLog.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "log failed");
      setWaLog("");
      setLogMsg("✓ Saved to the conversation log below.");
    } catch (e) { setLogMsg((e as Error).message); }
  }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const digits = (clientWhatsapp || "").replace(/[^\d]/g, "");
  const waLink = digits && text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;

  async function generate() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/whatsapp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "generate-failed");
      setText(j.text || "");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(text); setMsg("Copied."); }
    catch { setMsg("Select the text and copy manually."); }
  }

  return (
    <section style={card}>
      <div style={cardLabel}>WhatsApp nudge</div>
      <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 10 }}>
        A quick message to send after the email{clientWhatsapp ? <> — opens the chat with <b>{clientWhatsapp}</b>.</> : <> (add a WhatsApp number on the request to open the chat directly).</>}
      </div>

      <button type="button" onClick={generate} disabled={busy} style={primaryBtn}>
        {busy ? "Generating…" : text ? "Regenerate" : "Generate WhatsApp nudge"}
      </button>

      {text && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} style={textarea} />
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            {waLink && (
              <a href={waLink} target="_blank" rel="noopener noreferrer" style={{ ...primaryBtn, textDecoration: "none", display: "inline-block" }}>
                Open WhatsApp
              </a>
            )}
            <button type="button" onClick={copy} disabled={!text.trim()} style={ghostBtn}>Copy text</button>
          </div>
        </>
      )}

      {msg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 10 }}>{msg}</p>}
      {err && <p style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 10 }}>{err}</p>}
      <div style={{ marginTop: 14, borderTop: "1px solid rgba(13,27,42,0.08)", paddingTop: 12 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF", marginBottom: 6 }}>
          Log a WhatsApp exchange · paste it, keep the story with the request
        </div>
        <textarea value={waLog} onChange={(e) => setWaLog(e.target.value)} rows={4}
          placeholder="Paste the WhatsApp messages here (copy them in the app: press-and-hold, Copy). They are stored in this request's history with today's date."
          style={{ width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 }} />
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
          <button type="button" onClick={saveWaLog} disabled={!waLog.trim()}
            style={{ background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "8px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
            Save to history
          </button>
          {logMsg && <span style={{ fontSize: 12, color: logMsg.startsWith("✓") ? "#3A6B47" : "#b91c1c" }}>{logMsg}</span>}
        </div>
      </div>
    </section>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 };
const textarea: React.CSSProperties = { width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", marginTop: 8, lineHeight: 1.5 };
const primaryBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "9px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
