"use client";

// The Helm — follow-ups on a proposal already sent. Two ways, one place:
//   1. LOG a follow-up you did yourself (a call, a WhatsApp, an email by hand).
//      One button. It records the date, shows the running history, and sets the
//      next reminder 5 days out - so a month or a year later you know exactly
//      when you last reached out and when the next one is due.
//   2. DRAFT one for George to send in the client's Gmail thread (AI-composed,
//      reviewed, sent only on the button - never auto-sent).
// Shown only once the proposal has been sent (a thread exists).

import { useState } from "react";
import { useRouter } from "next/navigation";

type Entry = { at: string; how: string; byHand: boolean };

const HOW_OPTS: { key: string; label: string }[] = [
  { key: "call", label: "Phone call" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "email", label: "Email (by hand)" },
  { key: "person", label: "In person" },
  { key: "other", label: "Other" },
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// A plain, no-em-dash description of when the next follow-up is due.
function duePhrase(iso: string | null): { text: string; overdue: boolean; none: boolean } {
  if (!iso) return { text: "No next follow-up set yet.", overdue: false, none: true };
  const due = new Date(iso);
  const days = Math.round((due.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { text: `Follow-up due ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago (${fmtDate(iso)}).`, overdue: true, none: false };
  if (days === 0) return { text: `Follow-up due today (${fmtDate(iso)}).`, overdue: true, none: false };
  if (days === 1) return { text: `Next follow-up tomorrow (${fmtDate(iso)}).`, overdue: false, none: false };
  return { text: `Next follow-up in ${days} days (${fmtDate(iso)}).`, overdue: false, none: false };
}

export default function HelmFollowUp({
  requestId, clientEmail, isAgent, nextNumber, sentCount, followUpAt, history = [],
}: {
  requestId: string;
  clientEmail: string | null;
  isAgent: boolean;
  nextNumber: number;
  sentCount: number;
  followUpAt: string | null;
  history?: Entry[];
}) {
  const router = useRouter();
  const [how, setHow] = useState("call");
  const [note, setNote] = useState("");
  const [body, setBody] = useState("");
  const [reminder, setReminder] = useState(followUpAt ? followUpAt.slice(0, 10) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const who = isAgent ? "the travel agent" : "the client";
  const due = duePhrase(followUpAt);

  // ---- LOG a follow-up George already did, by hand ----
  async function logDone() {
    setBusy("log"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/followup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "log", how, note: note.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "log-failed");
      setMsg(`Logged. Follow-up ${j.followupNumber} on the record. Next reminder set for ${fmtDate(j.nextDue)}.`);
      setNote("");
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

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
      <div style={cardLabel}>Follow up · {isAgent ? "travel agent" : "client"}{sentCount > 0 && <span style={{ color: "#3A6B47" }}> · {sentCount} on the record</span>}</div>

      {/* WHEN THE NEXT ONE IS DUE — read at a glance */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", marginBottom: 14,
        border: `1px solid ${due.overdue ? "rgba(178,34,34,0.35)" : due.none ? "rgba(13,27,42,0.12)" : "rgba(201,168,76,0.4)"}`,
        background: due.overdue ? "rgba(178,34,34,0.05)" : due.none ? "#fafafa" : "rgba(201,168,76,0.06)",
        borderRadius: 2,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: due.overdue ? "#B22222" : due.none ? "#cbd5e1" : "#C9A84C", flex: "0 0 auto" }} />
        <span style={{ fontSize: 13, color: due.overdue ? "#B22222" : "#374151", fontWeight: due.overdue ? 600 : 400 }}>{due.text}</span>
      </div>

      {/* 1) LOG A FOLLOW-UP YOU DID — the one-press record */}
      <div style={{ border: "1px solid rgba(13,27,42,0.1)", padding: "12px 14px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#6b7280", fontWeight: 700, marginBottom: 8 }}>
          I followed up today
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6, margin: "0 0 10px" }}>
          Reached out yourself (a call, a message, an email by hand)? Log it. It records today&rsquo;s date and pushes the next reminder out 5 days.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <span style={fieldLabel}>How</span>
          <select value={how} onChange={(e) => setHow(e.target.value)} style={select}>
            {HOW_OPTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <input
          type="text" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (what you said, what they replied)…"
          style={{ width: "100%", padding: 9, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", marginBottom: 10 }}
        />
        <button type="button" onClick={logDone} disabled={busy !== null} style={primaryBtn}>
          {busy === "log" ? "Logging…" : "Log this follow-up (today)"}
        </button>
      </div>

      {/* HISTORY — so a month or a year later he knows when */}
      {history.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF", marginBottom: 6 }}>
            Follow-up history
          </div>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {history.map((h, i) => (
              <li key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", borderTop: i ? "1px solid rgba(13,27,42,0.06)" : "none" }}>
                <span style={{ fontSize: 12.5, color: "#0D1B2A", fontWeight: 600, minWidth: 96 }}>{fmtDate(h.at)}</span>
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  {h.byHand ? h.how : "email sent in thread"}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Manual reminder override */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <span style={fieldLabel}>Or set a specific reminder date</span>
        <input type="date" value={reminder} onChange={(e) => setReminder(e.target.value)} style={dateInput} />
        <button type="button" onClick={saveReminder} disabled={busy !== null || !reminder} style={ghostBtn}>
          {busy === "reminder" ? "Saving…" : "Set"}
        </button>
      </div>

      {/* 2) DRAFT ONE TO SEND — AI-composed, in the thread, never auto */}
      <div style={{ borderTop: "1px solid rgba(13,27,42,0.08)", paddingTop: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#6b7280", fontWeight: 700, marginBottom: 8 }}>
          Or draft one to send
        </div>
        <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 10 }}>
          Composes a short, human follow-up as a reply in the proposal thread to <b>{clientEmail || who}</b>. Next: <b>follow-up {nextNumber}</b>.
        </div>
        <button type="button" onClick={generate} disabled={busy !== null} style={ghostBtn}>
          {busy === "generate" ? "Generating…" : body ? `Regenerate follow-up ${nextNumber}` : `Generate follow-up ${nextNumber}`}
        </button>

        {body && (
          <>
            <label style={{ ...fieldLabel, marginTop: 12, display: "block" }}>
              Follow-up {nextNumber} (review and edit - replies in the proposal thread)
            </label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} style={textarea} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" onClick={send} disabled={busy !== null || !clientEmail || !body.trim()} style={primaryBtn}>
                {busy === "send" ? "Sending…" : `Send follow-up ${nextNumber} to ${clientEmail || who}`}
              </button>
            </div>
          </>
        )}
      </div>

      {msg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 10 }}>{msg}</p>}
      {err && <p style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 10 }}>{err}</p>}
      <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 10, fontStyle: "italic" }}>
        Logging records a follow-up you did yourself. Drafting replies in the same thread and never sends without the button. The daily reminder tells you when the next one is due.
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
const select: React.CSSProperties = { padding: 8, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", background: "#fff" };
