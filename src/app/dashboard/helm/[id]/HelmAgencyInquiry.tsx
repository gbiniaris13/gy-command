"use client";

// The Helm — email the CENTRAL AGENCY (the supplier). Broker-to-supplier B2B:
// full George Yachts identity, end client kept anonymous. George generates an
// editable draft, can copy the raw text, and presses "Send to central agency"
// (explicit confirm). Nothing is ever auto-sent. Separate from the client/agent
// proposal send.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HelmAgencyInquiry({
  requestId, agencyEmail, alreadySentTo,
}: {
  requestId: string;
  agencyEmail: string | null;
  alreadySentTo: string[];
}) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Split the agency list into ones still to contact vs ones already emailed
  // this inquiry (so we never double-send). The route re-checks server-side.
  const fieldList = (agencyEmail || "").split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const sentSet = new Set((alreadySentTo || []).map((e) => e.toLowerCase()));
  const fresh = fieldList.filter((e) => !sentSet.has(e.toLowerCase()));
  const skipped = fieldList.filter((e) => sentSet.has(e.toLowerCase()));
  const hasAgency = fieldList.length > 0;

  async function generate() {
    setBusy("generate"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/agency-inquiry`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "generate-failed");
      setSubject(j.subject || "");
      setBody(j.body || "");
      setMsg("Draft generated. Review and edit before sending.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function send(resendAll = false) {
    const targets = resendAll ? fieldList : fresh;
    if (!targets.length) return;
    const skipNote = !resendAll && skipped.length ? `Already contacted (will be SKIPPED): ${skipped.join(", ")}\n\n` : "";
    const ok = confirm(`Send a SEPARATE inquiry email to EACH of these ${resendAll ? "" : "NEW "}agenc${targets.length === 1 ? "y" : "ies"}?\n\n${targets.join("\n")}\n\n${skipNote}No recipient sees the others (no shared To, no Cc, no Bcc). Sent from your George Yachts inbox.`);
    if (!ok) return;
    setBusy("send"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/agency-inquiry`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", subject, body, resend_all: resendAll }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "send-failed");
      const n = j.sent ?? 0;
      const sk = j.skipped ?? 0;
      setMsg(n === 0
        ? (j.message || "Nothing was sent.")
        : `Sent ${n} separate email${n === 1 ? "" : "s"}${sk ? `; skipped ${sk} already-contacted` : ""} (one per agency, no one sees the others). Logged.`);
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(body); setMsg("Inquiry text copied."); }
    catch { setMsg("Select the text and copy manually."); }
  }

  return (
    <section style={card}>
      <div style={cardLabel}>Email the central agency · broker-to-supplier inquiry</div>

      <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 10 }}>
        {hasAgency ? (
          <>
            {fresh.length > 0 && <div>Will send to: <b>{fresh.join(", ")}</b></div>}
            {skipped.length > 0 && <div style={{ color: "#6b7280", marginTop: 2 }}>Already contacted (skipped): {skipped.join(", ")}</div>}
            {fresh.length === 0 && <div style={{ color: "#3A6B47" }}>All {fieldList.length} agenc{fieldList.length === 1 ? "y has" : "ies have"} already received this inquiry.</div>}
          </>
        ) : (
          <span style={{ color: "#7c4a03" }}>No central agency email yet. <a href={`/dashboard/helm/${requestId}/edit`} style={{ color: "#0D1B2A" }}>Add it via Edit</a> to enable sending.</span>
        )}
      </div>

      <button type="button" onClick={generate} disabled={busy !== null} style={primaryBtn}>
        {busy === "generate" ? "Generating…" : body ? "Regenerate draft" : "Generate inquiry"}
      </button>

      {(subject || body) && (
        <>
          <label style={{ ...fieldLabel, marginTop: 12, display: "block" }}>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} style={input} />

          <label style={{ ...fieldLabel, marginTop: 10, display: "block" }}>
            Inquiry (George voice, full George Yachts identity · the client stays anonymous to the supplier)
          </label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} style={textarea} />

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" onClick={() => send(false)} disabled={busy !== null || fresh.length === 0 || !body.trim() || !subject.trim()} style={primaryBtn}>
              {busy === "send" ? "Sending…" : fresh.length === 0 ? "All agencies contacted" : `Send to ${fresh.length} new agenc${fresh.length === 1 ? "y" : "ies"}`}
            </button>
            {skipped.length > 0 && (
              <button type="button" onClick={() => send(true)} disabled={busy !== null || !body.trim() || !subject.trim()} style={ghostBtn} title="Send to every address again, including the ones already contacted">
                Resend to all {fieldList.length}
              </button>
            )}
            <button type="button" onClick={copy} disabled={!body.trim()} style={ghostBtn}>Copy text</button>
          </div>
        </>
      )}

      {msg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 10 }}>{msg}</p>}
      {err && <p style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 10 }}>{err}</p>}
      <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 10, fontStyle: "italic" }}>
        Goes to the supplier from your inbox, never to the client. Multiple addresses each get a SEPARATE email (no one sees the others). An agency that already received this inquiry is skipped automatically. Your Gmail signature is added automatically. Nothing sends without the button. No attachment.
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
