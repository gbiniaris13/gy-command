"use client";

// The Helm — send the proposal + capture replies. George reviews/edits the
// draft here and presses Send; nothing is ever auto-sent. "Check replies"
// pulls the Gmail thread on demand (the daily cron does it automatically too).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_SNIPPETS, SNIPPET_CATEGORIES, type Snippet, type SnippetCategory,
} from "@/lib/helm/snippets";

const SNIPPETS_KEY = "helm_snippets_v1";

// Persisted custom snippets live only in the browser (free, no DB). All access
// is guarded for SSR — these run inside effects/handlers, never at module load.
function loadCustomSnippets(): Snippet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SNIPPETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Snippet =>
        s && typeof s.id === "string" && typeof s.label === "string" &&
        typeof s.body === "string" &&
        ["intro", "terms", "about", "closing"].includes(s.category),
    );
  } catch { return []; }
}
function saveCustomSnippets(list: Snippet[]) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(SNIPPETS_KEY, JSON.stringify(list)); } catch { /* quota/private mode */ }
}

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

  // --- Reusable snippets (George's voice) -----------------------------------
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [custom, setCustom] = useState<Snippet[]>([]);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  useEffect(() => { setCustom(loadCustomSnippets()); }, []);

  const allSnippets = [...DEFAULT_SNIPPETS, ...custom];

  // Insert a block at the caret without overwriting existing text. Falls back to
  // appending with a blank line when the textarea isn't focused. Keeps the
  // controlled-textarea sync intact (we only ever call setBody).
  function insertSnippet(text: string) {
    const ta = bodyRef.current;
    setBody((prev) => {
      if (!ta) {
        return prev.trim() ? `${prev.replace(/\s+$/, "")}\n\n${text}` : text;
      }
      const start = ta.selectionStart ?? prev.length;
      const end = ta.selectionEnd ?? prev.length;
      const before = prev.slice(0, start);
      const after = prev.slice(end);
      const lead = before && !before.endsWith("\n") ? "\n\n" : "";
      const trail = after && !after.startsWith("\n") ? "\n\n" : "";
      const next = `${before}${lead}${text}${trail}${after}`;
      // Restore the caret just past the inserted block after React re-renders.
      const caret = (before + lead + text).length;
      requestAnimationFrame(() => {
        ta.focus();
        try { ta.setSelectionRange(caret, caret); } catch { /* noop */ }
      });
      return next;
    });
  }

  function saveSelectionAsSnippet() {
    const ta = bodyRef.current;
    const sel = ta ? body.slice(ta.selectionStart ?? 0, ta.selectionEnd ?? 0).trim() : "";
    const seed = sel || "";
    const text = window.prompt("Snippet text to save:", seed);
    if (!text || !text.trim()) return;
    const label = window.prompt("Short label for this snippet:", "My snippet");
    if (!label || !label.trim()) return;
    const cat = (window.prompt("Category — intro, terms, about or closing:", "closing") || "")
      .trim().toLowerCase();
    const category: SnippetCategory =
      cat === "intro" || cat === "terms" || cat === "about" || cat === "closing" ? cat : "closing";
    const next = [
      ...custom,
      { id: `custom-${Date.now()}`, label: label.trim().slice(0, 40), category, body: text.trim() },
    ];
    setCustom(next); saveCustomSnippets(next);
  }

  function deleteSnippet(id: string) {
    const next = custom.filter((s) => s.id !== id);
    setCustom(next); saveCustomSnippets(next);
  }

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

  async function shareWhatsApp() {
    setBusy("wa"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/share-link`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "share-failed");
      const base = j.whatsapp ? `https://wa.me/${j.whatsapp}` : "https://wa.me/";
      window.open(`${base}?text=${encodeURIComponent(j.message)}`, "_blank");
      setMsg("WhatsApp opened with the proposal link (valid 7 days).");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

  return (
    <section style={card}>
      <div style={cardLabel}>Send proposal {alreadySent && <span style={{ color: "#3A6B47" }}>· sent</span>}</div>

      {!clientEmail && <div style={warnBox}>No client email on this request — add one (edit) before sending.</div>}

      <label style={fieldLabel}>Subject</label>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} style={input} placeholder="Your Greek charter" />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 10, gap: 8, flexWrap: "wrap" }}>
        <label style={{ ...fieldLabel, display: "block" }}>Email body (first-person George — edit before sending)</label>
        <button type="button" onClick={() => setSnippetsOpen((v) => !v)} style={snippetToggle}>
          {snippetsOpen ? "Hide snippets" : "Insert snippet"}
        </button>
      </div>

      {snippetsOpen && (
        <div style={snippetPanel}>
          {SNIPPET_CATEGORIES.map(({ key, label }) => {
            const items = allSnippets.filter((s) => s.category === key);
            if (items.length === 0) return null;
            return (
              <div key={key} style={{ marginBottom: 8 }}>
                <div style={snippetGroupLabel}>{label}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {items.map((s) => {
                    const isCustom = s.id.startsWith("custom-");
                    return (
                      <span key={s.id} style={chipWrap}>
                        <button type="button" onClick={() => insertSnippet(s.body)} style={chip}
                          title={s.body.length > 120 ? `${s.body.slice(0, 120)}…` : s.body}>
                          {s.label}
                        </button>
                        {isCustom && (
                          <button type="button" onClick={() => deleteSnippet(s.id)} style={chipDelete}
                            title="Delete this custom snippet" aria-label={`Delete snippet ${s.label}`}>×</button>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <button type="button" onClick={saveSelectionAsSnippet} style={snippetSaveBtn}>
            + Save current selection as snippet
          </button>
        </div>
      )}

      <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={10} style={textarea} placeholder="Dear Mr./Mrs. [Surname]," />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={send} disabled={busy !== null || !clientEmail || !body.trim()} style={primaryBtn}>
          {busy === "send" ? "Sending…" : alreadySent ? `Resend to ${clientEmail || "client"}` : `Send to ${clientEmail || "client"}`}
        </button>
        <button type="button" onClick={shareWhatsApp} disabled={busy !== null} style={ghostBtn} title="Open WhatsApp with a link to this proposal (valid 7 days)">
          {busy === "wa" ? "Preparing…" : "Share on WhatsApp"}
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
const snippetToggle: React.CSSProperties = { background: "none", border: "none", color: "#C9A84C", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", padding: 0 };
const snippetPanel: React.CSSProperties = { border: "1px solid rgba(13,27,42,0.1)", background: "rgba(13,27,42,0.015)", padding: "10px 12px", marginTop: 6 };
const snippetGroupLabel: React.CSSProperties = { fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF", marginBottom: 5 };
const chipWrap: React.CSSProperties = { display: "inline-flex", alignItems: "stretch" };
const chip: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "5px 10px", fontSize: 11.5, cursor: "pointer", lineHeight: 1.3 };
const chipDelete: React.CSSProperties = { background: "#fff", color: "#9CA3AF", borderTop: "1px solid rgba(13,27,42,0.2)", borderRight: "1px solid rgba(13,27,42,0.2)", borderBottom: "1px solid rgba(13,27,42,0.2)", borderLeft: "none", padding: "0 7px", fontSize: 13, cursor: "pointer", lineHeight: 1 };
const snippetSaveBtn: React.CSSProperties = { background: "none", border: "1px dashed rgba(13,27,42,0.25)", color: "#6b7280", padding: "6px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", marginTop: 4 };
