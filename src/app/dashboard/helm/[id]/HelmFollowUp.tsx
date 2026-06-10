"use client";

// The Helm — follow up on a proposal already sent. George generates a short,
// human follow-up (voice adapts to client vs travel agent), reviews/edits it,
// and presses Send — it goes as a reply in the same Gmail thread. Nothing is
// ever auto-sent. Shown only once the proposal has been sent (a thread exists).

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HelmFollowUp({
  requestId, clientEmail, isAgent, nextNumber, sentCount, followUpAt,
}: {
  requestId: string;
  clientEmail: string | null;
  isAgent: boolean;
  nextNumber: number;
  sentCount: number;
  followUpAt: string | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [reminder, setReminder] = useState(followUpAt ? followUpAt.slice(0, 10) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const who = isAgent ? "the travel agent" : "the client";

  async function saveReminder() {
    if (!reminder) return;
    setBusy("reminder"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ follow_up_at: new Date(`${reminder}T09:00:00Z`).toISOString() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "update-failed");
      setMsg(`Next reminder set for ${reminder}.`);
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function generate() {
    setBusy("generate"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/followup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "generate-failed");
      setBody(j.body || "");
      setMsg(`Follow-up ${j.followupNumber} draft ready. Review and edit before sending.`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function send() {
    if (!clientEmail) return;
    const ok = confirm(`Send follow-up ${nextNumber} to ${clientEmail}?\n\nIt is sent as a reply in the same email thread as the proposal. Your Gmail signature is added automatically.`);
    if (!ok) return;
    setBusy("send"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/followup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", body }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "send-failed");
      setMsg(`Follow-up ${j.followupNumber} sent to ${who}. Logged in the thread.`);
      setBody("");
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <section style={card}>
      <div style={cardLabel}>Follow up · {isAgent ? "travel agent" : "client"}{sentCount > 0 && <span style={{ color: "#3A6B47" }}> · {sentCount} sent</span>}</div>

      <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 10 }}>
        Sends a short, human follow-up as a reply in the proposal thread to <b>{clientEmail || who}</b>. Next: <b>follow-up {nextNumber}</b>.
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span style={fieldLabel}>Reminder date</span>
        <input type="date" value={reminder} onChange={(e) => setReminder(e.target.value)} style={dateInput} />
        <button type="button" onClick={saveReminder} disabled={busy !== null || !reminder} style={ghostBtn}>
          {busy === "reminder" ? "Saving…" : "Set"}
        </button>
      </div>

      <button type="button" onClick={generate} disabled={busy !== null} style={primaryBtn}>
        {busy === "generate" ? "Generating…" : body ? `Regenerate follow-up ${nextNumber}` : `Generate follow-up ${nextNumber}`}
      </button>

      {body && (
        <>
          <label style={{ ...fieldLabel, marginTop: 12, display: "block" }}>
            Follow-up {nextNumber} (review and edit — replies in the proposal thread)
          </label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} style={textarea} />
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" onClick={send} disabled={busy !== null || !clientEmail || !body.trim()} style={primaryBtn}>
              {busy === "send" ? "Sending…" : `Send follow-up ${nextNumber} to ${clientEmail || who}`}
            </button>
          </div>
        </>
      )}

      {msg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 10 }}>{msg}</p>}
      {err && <p style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 10 }}>{err}</p>}
      <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 10, fontStyle: "italic" }}>
        Replies in the same thread, never starts a new email. Nothing sends without the button. The daily reminder tells you when the next one is due.
      </p>
    </section>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 };
const fieldLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" };
const textarea: React.CSSProperties = { width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", marginTop: 4, lineHeight: 1.5 };
const primaryBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "8px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const dateInput: React.CSSProperties = { padding: 7, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit" };
