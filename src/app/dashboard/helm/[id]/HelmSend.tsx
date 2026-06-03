"use client";

// The Helm — send the proposal + capture replies. George reviews/edits the
// draft here and presses Send; nothing is ever auto-sent. "Check replies"
// pulls the Gmail thread on demand (the daily cron does it automatically too).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function HelmSend({
  requestId, clientEmail, initialSubject, initialBody, status, followUpAt, threadId,
}: {
  requestId: string;
  clientEmail: string | null;
  initialSubject: string | null;
  initialBody: string | null;
  status: string;
  followUpAt: string | null;
  threadId: string | null;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject || "");
  const [body, setBody] = useState(initialBody || "");
  // Adopt the freshly generated email whenever a Regenerate writes new text to
  // the request (router.refresh() updates these props). This removes the trap
  // where the Send box kept stale text after a regenerate. Manual edits are
  // preserved while the stored draft is unchanged (the effect only fires when
  // the DB value itself changes, i.e. after a new generate).
  useEffect(() => { setSubject(initialSubject || ""); }, [initialSubject]);
  useEffect(() => { setBody(initialBody || ""); }, [initialBody]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const alreadySent = !!threadId || status === "sent" || status === "in_conversation" || status === "negotiating" || status === "won";

  async function send() {
    if (!clientEmail) return;
    const ok = confirm(`Send this proposal email to ${clientEmail}? The generated PDF will be attached.`);
    if (!ok) return;
    setBusy("send"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "send-failed");
      setMsg("Sent ✓ — moved to Sent, follow-up reminder set for 4 days.");
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function checkReplies() {
    setBusy("check"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/check-replies`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "check-failed");
      setMsg(j.newReplies > 0 ? `${j.newReplies} new repl${j.newReplies === 1 ? "y" : "ies"} captured.` : "No new replies.");
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

  return (
    <section style={card}>
      <div style={cardLabel}>Send proposal {alreadySent && <span style={{ color: "#3A6B47" }}>· sent</span>}</div>

      {!clientEmail && <div style={warnBox}>No client email on this request — add one (edit) before sending.</div>}

      <label style={fieldLabel}>Subject</label>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} style={input} placeholder="Your Greek charter" />

      <label style={{ ...fieldLabel, marginTop: 10, display: "block" }}>Email body (first-person George — edit before sending)</label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} style={textarea} placeholder="Dear Mr./Mrs. [Surname]," />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={send} disabled={busy !== null || !clientEmail || !body.trim()} style={primaryBtn}>
          {busy === "send" ? "Sending…" : alreadySent ? `Resend to ${clientEmail || "client"}` : `Send to ${clientEmail || "client"}`}
        </button>
        {alreadySent && (
          <button type="button" onClick={checkReplies} disabled={busy !== null} style={ghostBtn}>
            {busy === "check" ? "Checking…" : "Check replies"}
          </button>
        )}
        {followUpAt && status === "sent" && (
          <span style={{ fontSize: 12, color: "#6b7280" }}>follow-up reminder: {fmt(followUpAt)}</span>
        )}
      </div>

      {msg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 10 }}>{msg}</p>}
      {err && <p style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 10 }}>{err}</p>}
      <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 10, fontStyle: "italic" }}>
        Nothing sends without this button. The PDF is attached automatically. Replies are captured here and by the daily reminder.
      </p>
    </section>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 };
const fieldLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" };
const input: React.CSSProperties = { width: "100%", padding: 9, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", marginTop: 4 };
const textarea: React.CSSProperties = { width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", marginTop: 4, lineHeight: 1.5 };
const primaryBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "9px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const warnBox: React.CSSProperties = { background: "rgba(176,122,44,0.08)", border: "1px solid rgba(176,122,44,0.4)", color: "#7c4a03", padding: "8px 12px", marginBottom: 12, fontSize: 12.5 };
