"use client";

// The Helm — draft and send a reply to an incoming client/agent message. Reads
// their latest reply and answers it (voice adapts to client vs agent). George
// reviews/edits, then sends as a reply in the same Gmail thread. Never auto-sent.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HelmReply({
  requestId, clientEmail, isAgent, hasInbound,
}: {
  requestId: string;
  clientEmail: string | null;
  isAgent: boolean;
  hasInbound: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const who = isAgent ? "the agent" : "the client";

  async function generate() {
    setBusy("generate"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/reply`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "generate-failed");
      setBody(j.body || "");
      setMsg("Reply draft ready — it answers their latest message. Review and edit before sending.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function send() {
    if (!clientEmail) return;
    const ok = confirm(`Send this reply to ${clientEmail}?\n\nIt is sent in the same email thread. Your signature is added automatically.`);
    if (!ok) return;
    setBusy("send"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/reply`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", body }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "send-failed");
      setMsg(`Reply sent to ${who}. Logged in the thread.`);
      setBody("");
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <section style={card}>
      <div style={cardLabel}>Reply · {isAgent ? "travel agent" : "client"}</div>
      <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 10 }}>
        {hasInbound
          ? <>Drafts an answer to their latest reply and sends it in the thread to <b>{clientEmail || who}</b>.</>
          : <span style={{ color: "#7c4a03" }}>No incoming reply captured yet. Use “Check replies” above first.</span>}
      </div>

      <button type="button" onClick={generate} disabled={busy !== null || !hasInbound} style={primaryBtn}>
        {busy === "generate" ? "Generating…" : body ? "Regenerate reply" : "Draft a reply"}
      </button>

      {body && (
        <>
          <label style={{ ...fieldLabel, marginTop: 12, display: "block" }}>Reply (review and edit — sends in the thread)</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} style={textarea} />
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" onClick={send} disabled={busy !== null || !clientEmail || !body.trim()} style={primaryBtn}>
              {busy === "send" ? "Sending…" : `Send reply to ${clientEmail || who}`}
            </button>
          </div>
        </>
      )}

      {msg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 10 }}>{msg}</p>}
      {err && <p style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 10 }}>{err}</p>}
    </section>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 };
const fieldLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" };
const textarea: React.CSSProperties = { width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", marginTop: 4, lineHeight: 1.5 };
const primaryBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
