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
import type { FollowupSettings } from "@/lib/helm/followup/settings";
import { TZ_CHOICES } from "@/lib/helm/followup/calendar";

// 2026-11-16 — the research engine's answer, as the route returns it.
type Draft = { touch_type?: string; channel?: string; subject?: string; body?: string; voice_note_script?: string; call_talking_points?: string[]; angle_el?: string };
type Slot = { client_local: string; athens: string; window_client: string; window_athens: string; tz: string } | null;
type Gen = {
  generated_at: string; model: string; snapshot_el: string; temperature: string; scenario: string; scenario_code: string;
  we_owe_client: string | null;
  next_touch: Draft & { touch_number: number; recipient_role: string; rationale_el: string; slot: Slot };
  whatsapp_companion: { body: string; hold: boolean; hold_reason_el: string; slot: Slot; wa_link_digits: string } | null;
  alternatives: Draft[];
  forward_plan: { date: string; touch: string; anchor: string; kind: string }[];
  requires_human: boolean; requires_human_reason_el: string; warnings_el: string[]; checks: string[];
  facts: { tz: string; tz_source: string; bucket: string; L_days: number | null; decision_deadline: string | null; consecutive_unanswered: number; last_inbound_at: string | null; last_outbound_at: string | null; ball: string; gmail_messages: number };
  reply_thread: { thread_id: string; subject: string } | null;
};
const nice = (t?: string) => (t || "").replace(/_/g, " ");
const CH_LABEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", imessage: "iMessage", call: "Phone call", voice_note: "Voice note", none: "No contact" };

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
  clientWhatsapp = null, settings = {}, tzInfo = { tz: "America/New_York", source: "default" }, nextStepIndex = -1,
}: {
  requestId: string;
  clientEmail: string | null;
  isAgent: boolean;
  nextNumber: number;
  sentCount: number;
  followUpAt: string | null;
  history?: Entry[];
  clientWhatsapp?: string | null;
  settings?: FollowupSettings;
  tzInfo?: { tz: string; source: string };
  nextStepIndex?: number;
}) {
  const router = useRouter();
  const [how, setHow] = useState("call");
  const [note, setNote] = useState("");
  const [body, setBody] = useState("");
  const [reminder, setReminder] = useState(followUpAt ? followUpAt.slice(0, 10) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gen, setGen] = useState<Gen | null>(null);
  const [subject, setSubject] = useState("");
  const [asNew, setAsNew] = useState(false);
  const [touch, setTouch] = useState<string | undefined>(undefined);
  const [draftBody, setDraftBody] = useState<string | null>(null);
  const [needsRegen, setNeedsRegen] = useState(false);
  const [waText, setWaText] = useState("");
  const [waDone, setWaDone] = useState(false);
  const [emailDone, setEmailDone] = useState(false);
  // follow-up facts
  const [tz, setTz] = useState(settings.tz || tzInfo.tz);
  const [optExp, setOptExp] = useState(settings.option_expires_at || "");
  const [ebDate, setEbDate] = useState(settings.early_booking_deadline || "");
  const [ebPct, setEbPct] = useState(settings.early_booking_pct ? String(settings.early_booking_pct) : "");
  const [clientDate, setClientDate] = useState(settings.client_followup_date || "");
  const [extra, setExtra] = useState((settings.extra_emails || []).join(", "));
  const [waOk, setWaOk] = useState(!!settings.whatsapp_ok);
  const [showFacts, setShowFacts] = useState(false);
  const waDigits = (clientWhatsapp || "").replace(/[^\d]/g, "");

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

  async function saveFacts() {
    setBusy("facts"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/followup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fu-settings", tz, option_expires_at: optExp || null, early_booking_deadline: ebDate || null,
          early_booking_pct: ebPct ? Number(ebPct) : null, client_followup_date: clientDate || null, extra_emails: extra, whatsapp_ok: waOk,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "save-failed");
      setMsg("Saved. Generate uses these facts from now on.");
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  function applyDraft(d: Draft) {
    setSubject(d.subject || "");
    setBody(d.body || d.voice_note_script || "");
    setDraftBody(d.body || d.voice_note_script || "");
    setTouch(d.touch_type);
  }

  async function generate(differentFrom?: string) {
    setBusy("generate"); setErr(null); setMsg(null); setNeedsRegen(false);
    try {
      const r = await fetch(`/api/helm/${requestId}/followup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", ...(differentFrom ? { different_from: differentFrom } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "generate-failed");
      const g = j as Gen;
      setGen(g);
      applyDraft(g.next_touch);
      setWaText(g.whatsapp_companion?.body || "");
      setWaDone(false); setEmailDone(false);
      setAsNew(false);
      if (g.next_touch.channel !== "none" && !(g.next_touch.body || g.next_touch.voice_note_script || "").trim()) {
        setErr("The draft came back empty. Press Generate again, or write it yourself in the box.");
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function send(force = false) {
    if (!clientEmail) return;
    const where = asNew && subject.trim() ? `as a NEW email, subject "${subject.trim()}"` : `as a reply in ${gen?.reply_thread ? `the thread "${gen.reply_thread.subject}"` : "the proposal thread"}`;
    const ok = confirm(`Send this follow-up to ${clientEmail}?\n\nIt goes ${where}. Your Gmail signature is added automatically.`);
    if (!ok) return;
    setBusy("send"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/followup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send", body, subject, as_new_email: asNew, force,
          thread_id: gen?.reply_thread?.thread_id, generated_at: gen?.generated_at,
          touch_type: touch, scenario_code: gen?.scenario_code, draft_body: draftBody,
          last_inbound_at: gen?.facts.last_inbound_at,
        }),
      });
      const j = await r.json();
      if (r.status === 409 && j.code === "inbound-since") { setNeedsRegen(true); throw new Error(j.error); }
      if (!r.ok) throw new Error(j.error || "send-failed");
      const pairPending = !!gen?.whatsapp_companion && !waDone;
      setMsg(`Email sent to ${who}. The plan moved on${j.next ? ` (next: ${fmtDate(j.next)})` : ""}.${pairPending ? " Now the WhatsApp version below." : ""}`);
      setEmailDone(true);
      if (!pairPending) { setBody(""); setGen(null); setDraftBody(null); setSubject(""); }
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  // THE PAIR: the WhatsApp version went from George's phone; record it.
  async function waSent() {
    setBusy("wa"); setErr(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/followup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "wa-sent", body: waText, tick: false, touch_type: touch }),
      });
      if (!r.ok) throw new Error("record-failed");
      setWaDone(true);
      setMsg(emailDone ? "Email and WhatsApp both recorded. Done for today." : "WhatsApp recorded. Now send the email above.");
      if (emailDone) { setBody(""); setGen(null); setDraftBody(null); setSubject(""); }
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  // WhatsApp / call / voice note are done by George by hand; one click records it.
  async function markDoneBy(how: string) {
    if (nextStepIndex < 0) { setErr("No open step in the plan to tick. Use 'Log this follow-up' above."); return; }
    setBusy("mark"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/followup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "plan-done", step: nextStepIndex, how, touch }),
      });
      if (!r.ok) throw new Error("mark-failed");
      setMsg(`Recorded: ${how}. The plan moved on.`);
      setGen(null); setBody(""); setDraftBody(null);
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

      {/* 2) GENERATE — the research engine (2026-11-16). Reads every thread,
          the pasted WhatsApp and your notes; writes; you press Send. */}
      <div style={{ borderTop: "1px solid rgba(13,27,42,0.08)", paddingTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#6b7280", fontWeight: 700 }}>
            Next follow-up
          </div>
          <button type="button" onClick={() => setShowFacts((v) => !v)} style={{ ...ghostBtn, padding: "5px 10px" }}>
            {showFacts ? "Hide facts" : `Facts · ${tz}${tzInfo.source !== "stored" && !settings.tz ? " (guess)" : ""}`}
          </button>
        </div>

        {showFacts && (
          <div style={{ border: "1px solid rgba(13,27,42,0.1)", padding: "10px 12px", marginBottom: 12, display: "grid", gap: 8 }}>
            <p style={{ fontSize: 11.5, color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
              Ο πελάτης ζει σε άλλη ώρα· οι προθεσμίες μπαίνουν στο κείμενο ΜΟΝΟ αν είναι γραμμένες εδώ.
            </p>
            <label style={rowLbl}><span style={fieldLabel}>Client time zone</span>
              <select value={tz} onChange={(e) => setTz(e.target.value)} style={select}>
                {Array.from(new Set([tz, ...TZ_CHOICES])).map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </label>
            <label style={rowLbl}><span style={fieldLabel}>Option expires (from the central agent)</span>
              <input type="date" value={optExp} onChange={(e) => setOptExp(e.target.value)} style={dateInput} /></label>
            <label style={rowLbl}><span style={fieldLabel}>Owner early-booking deadline · %</span>
              <span style={{ display: "flex", gap: 6 }}>
                <input type="date" value={ebDate} onChange={(e) => setEbDate(e.target.value)} style={dateInput} />
                <input type="number" min={1} max={40} value={ebPct} onChange={(e) => setEbPct(e.target.value)} placeholder="%" style={{ ...dateInput, width: 64 }} />
              </span></label>
            <label style={rowLbl}><span style={fieldLabel}>Client asked to talk on</span>
              <input type="date" value={clientDate} onChange={(e) => setClientDate(e.target.value)} style={dateInput} /></label>
            <label style={rowLbl}><span style={fieldLabel}>Other addresses (spouse, assistant, advisor)</span>
              <input type="text" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="name@example.com, …" style={{ ...dateInput, minWidth: 240 }} /></label>
            {clientWhatsapp && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#374151" }}>
                <input type="checkbox" checked={waOk} onChange={(e) => setWaOk(e.target.checked)} />
                WhatsApp OK with this client (they write there, or said it is fine)
              </label>
            )}
            <div><button type="button" onClick={saveFacts} disabled={busy !== null} style={ghostBtn}>{busy === "facts" ? "Saving…" : "Save facts"}</button></div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <button type="button" onClick={() => generate()} disabled={busy !== null} style={primaryBtn}>
            {busy === "generate" ? "Reading the whole conversation…" : gen ? "Generate again" : "Generate"}
          </button>
          {gen && (
            <button type="button" onClick={() => generate(body.slice(0, 400))} disabled={busy !== null} style={ghostBtn}>
              Different angle
            </button>
          )}
        </div>

        {gen && (
          <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
            {gen.requires_human && (
              <div style={{ ...noteBox, borderColor: "rgba(178,34,34,0.4)", background: "rgba(178,34,34,0.05)", color: "#8b1c1c" }}>
                <b>Αποφασίζεις εσύ.</b> {gen.requires_human_reason_el}
              </div>
            )}
            <div style={{ ...noteBox, background: "#FAF8F3" }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <span style={chip}>{gen.scenario}</span>
                <span style={chip}>{gen.temperature}</span>
                <span style={chip}>{gen.facts.bucket}{gen.facts.L_days !== null ? ` · ${gen.facts.L_days} days to charter` : ""}</span>
                {gen.facts.decision_deadline && <span style={chip}>decision by {fmtDate(gen.facts.decision_deadline)}</span>}
                <span style={chip}>{gen.facts.consecutive_unanswered} unanswered</span>
                <span style={chip}>{gen.facts.gmail_messages} emails read</span>
              </div>
              <div style={{ fontSize: 13.5, color: "#0D1B2A", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{gen.snapshot_el}</div>
              {gen.we_owe_client && <div style={{ marginTop: 8, fontSize: 13, color: "#8a5a00" }}><b>Χρωστάμε:</b> {gen.we_owe_client}</div>}
            </div>

            {gen.next_touch.channel !== "none" && (
              <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.6 }}>
                <b>{CH_LABEL[gen.next_touch.channel || "email"] || gen.next_touch.channel}</b> · {nice(touch || gen.next_touch.touch_type)}
                {gen.next_touch.slot && (
                  <> · best <b>{gen.next_touch.slot.window_athens}</b> Athens ({gen.next_touch.slot.window_client} {gen.next_touch.slot.tz.split("/").pop()?.replace("_", " ")}), {fmtDate(gen.next_touch.slot.athens.slice(0, 10))}</>
                )}
                {gen.next_touch.rationale_el && <div style={{ color: "#6b7280" }}>{gen.next_touch.rationale_el}</div>}
              </div>
            )}
          </div>
        )}

        {(gen?.next_touch.channel ?? "email") === "email" && (
          <>
            <label style={{ ...fieldLabel, display: "block" }}>Subject</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={gen?.reply_thread ? `Re: ${gen.reply_thread.subject}` : "Re: (the proposal thread)"} style={{ ...textarea, marginBottom: 6 }} />
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#374151", marginBottom: 8 }}>
              <input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} />
              Send as a new email with this subject (otherwise it replies in {gen?.reply_thread ? `"${gen.reply_thread.subject}"` : "the proposal thread"})
            </label>
          </>
        )}
        <label style={{ ...fieldLabel, display: "block" }}>
          {gen?.next_touch.channel === "whatsapp" ? "WhatsApp message" : gen?.next_touch.channel === "voice_note" ? "Voice-note script" : gen?.next_touch.channel === "call" ? "Call notes" : "Email (begin with the greeting; your signature is added)"}
        </label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} style={textarea}
          placeholder="Press Generate, or write it yourself here." />
        {gen?.next_touch.call_talking_points && gen.next_touch.call_talking_points.length > 0 && (
          <ul style={{ fontSize: 12.5, color: "#374151", margin: "8px 0 0 18px" }}>{gen.next_touch.call_talking_points.map((t, i) => <li key={i}>{t}</li>)}</ul>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          {(gen?.next_touch.channel ?? "email") === "email" ? (
            <button type="button" onClick={() => send()} disabled={busy !== null || !clientEmail || !body.trim()} style={primaryBtn}>
              {busy === "send" ? "Sending…" : `Send follow-up ${nextNumber} to ${clientEmail || who}`}
            </button>
          ) : gen?.next_touch.channel === "none" ? null : (
            <>
              {gen?.next_touch.channel === "whatsapp" && waDigits && (
                <a href={`https://wa.me/${waDigits}?text=${encodeURIComponent(body)}`} target="_blank" rel="noreferrer" style={{ ...primaryBtn, textDecoration: "none" }}>Open in WhatsApp</a>
              )}
              <button type="button" onClick={() => navigator.clipboard?.writeText(body)} style={ghostBtn}>Copy</button>
              <button type="button" onClick={() => markDoneBy(gen?.next_touch.channel === "whatsapp" ? "whatsapp" : gen?.next_touch.channel === "call" ? "phone call" : "voice note")} disabled={busy !== null} style={ghostBtn}>
                {busy === "mark" ? "…" : "I sent it, record it"}
              </button>
            </>
          )}
          {needsRegen && <button type="button" onClick={() => generate()} style={ghostBtn}>Generate again</button>}
        </div>

        {gen?.whatsapp_companion && (
          <div style={{ ...noteBox, marginTop: 14, borderColor: "rgba(37,211,102,0.45)", background: "rgba(37,211,102,0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <span style={{ ...fieldLabel, color: "#1f7a46" }}>WhatsApp · same idea{waDone ? " · recorded ✓" : ""}</span>
              {gen.whatsapp_companion.slot && (
                <span style={{ fontSize: 11.5, color: "#6b7280" }}>best {gen.whatsapp_companion.slot.window_athens} Athens</span>
              )}
            </div>
            {gen.whatsapp_companion.hold && (
              <div style={{ fontSize: 12, color: "#8a5a00", marginBottom: 6 }}>{gen.whatsapp_companion.hold_reason_el}</div>
            )}
            <textarea value={waText} onChange={(e) => setWaText(e.target.value)} rows={4} style={textarea} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              {gen.whatsapp_companion.wa_link_digits && (
                <a href={`https://wa.me/${gen.whatsapp_companion.wa_link_digits}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer"
                  style={{ ...primaryBtn, textDecoration: "none", background: "#1f7a46", borderColor: "#1f7a46" }}>Open in WhatsApp</a>
              )}
              <button type="button" onClick={() => navigator.clipboard?.writeText(waText)} style={ghostBtn}>Copy</button>
              <button type="button" onClick={waSent} disabled={busy !== null || waDone || !waText.trim()} style={ghostBtn}>
                {busy === "wa" ? "…" : waDone ? "Recorded" : "I sent it on WhatsApp"}
              </button>
            </div>
          </div>
        )}

        {gen && gen.alternatives.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ ...fieldLabel, marginBottom: 6 }}>Two other angles</div>
            <div style={{ display: "grid", gap: 8 }}>
              {gen.alternatives.map((a, i) => (
                <div key={i} style={noteBox}>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{nice(a.touch_type)} · {a.angle_el}</div>
                  {a.subject && <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0D1B2A" }}>{a.subject}</div>}
                  <div style={{ fontSize: 12.5, color: "#374151", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{a.body}</div>
                  <button type="button" onClick={() => applyDraft(a)} style={{ ...ghostBtn, marginTop: 6, padding: "4px 10px" }}>Use this one</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {gen && gen.forward_plan.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ ...fieldLabel, marginBottom: 6 }}>The plan after this</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#374151", lineHeight: 1.7 }}>
              {gen.forward_plan.map((p, i) => <li key={i}><b>{fmtDate(p.date)}</b> · {nice(p.touch)}{p.anchor ? ` · ${p.anchor}` : ""}</li>)}
            </ol>
          </div>
        )}

        {gen && gen.warnings_el.length > 0 && (
          <ul style={{ marginTop: 12, paddingLeft: 18, fontSize: 12, color: "#8a5a00", lineHeight: 1.6 }}>
            {gen.warnings_el.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>

      {msg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 10 }}>{msg}</p>}
      {err && <p style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 10 }}>{err}</p>}
      <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 10, fontStyle: "italic" }}>
        Nothing is ever sent without your button. Generate reads every email with this client, the WhatsApp you pasted and your notes, and writes from the follow-up playbook. The morning email tells you who is due.
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
const noteBox: React.CSSProperties = { border: "1px solid rgba(13,27,42,0.1)", padding: "10px 12px", borderRadius: 2 };
const chip: React.CSSProperties = { fontSize: 10.5, padding: "2px 8px", border: "1px solid rgba(201,168,76,0.45)", color: "#7a6224", borderRadius: 10, letterSpacing: 0.3 };
const rowLbl: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" };
const select: React.CSSProperties = { padding: 8, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", background: "#fff" };
