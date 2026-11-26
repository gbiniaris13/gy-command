// @ts-nocheck
"use client";

// The Lighthouse "Επερχόμενα", 25/11/2026: ONE list for everything a client
// receives from George, in the order it happens. The brain is the After sales
// calendar (research of 25/11/2026: when, to whom, in what words); this is
// its only screen. Today first, with Generate / Send / Παράλειψε; then the
// charters with "Κάτι πήγε στραβά"; then the year ahead, every message
// readable before its day. Nothing leaves without George pressing Send.

import { useCallback, useEffect, useMemo, useState } from "react";

const GOLD = "#DAA110";
const CARD = "rounded-2xl border border-white/10 bg-deep-space/60 p-4";
const BTN_GHOST = "rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-soft-white hover:bg-white/15 disabled:opacity-50";
const BTN_GOLD = "rounded-full px-5 py-2 text-sm font-bold text-deep-space disabled:opacity-50";
const INPUT = "w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm leading-relaxed text-soft-white outline-none focus:border-white/30";
const LOST_EL = { budget: "Budget", silence: "Σιωπή", short: "Ήθελε λίγες μέρες", dates: "Ημερομηνίες", plans: "Άλλαξαν σχέδια", broker: "Άλλος broker", personal: "Προσωπικοί λόγοι" };
const ROLE_EL = { lead: "πελάτης", guest: "επιβάτης", advisor: "advisor" };
const CARD_KINDS = ["birthday", "holiday", "season"];

function Chip({ children, tone = "neutral" }) {
  const map = { good: "bg-emerald/15 text-emerald", warn: "bg-amber/15 text-amber", bad: "bg-hot-red/15 text-hot-red", gold: "bg-[#DAA110]/15 text-[#DAA110]", neutral: "bg-white/10 text-muted-blue" };
  return <span className={`inline-block rounded-full px-3 py-1 text-[11px] font-semibold ${map[tone]}`}>{children}</span>;
}

function DateBlock({ iso }) {
  const d = new Date(iso + "T00:00:00");
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return (
    <div className="w-16 shrink-0 text-center">
      <p className="text-2xl font-bold leading-none text-soft-white">{d.getDate()}</p>
      <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-blue">{d.toLocaleDateString("el-GR", { month: "short" }).replace(".", "")}</p>
      {!thisYear && <p className="text-[10px] text-muted-blue/70">{d.getFullYear()}</p>}
    </div>
  );
}

const fmt = (iso) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("el-GR", { day: "numeric", month: "long", timeZone: "UTC" }) : "");
// "STEVENS, PATRICIA RHODES" (a passport) reads "Patricia Rhodes Stevens";
// "SCOTT BURK" and "Mark stevens" read "Scott Burk", "Mark Stevens".
const nameOf = (p) => {
  let n = String(p.full_name || "").trim();
  if (!n) return p.first_name;
  if (n.includes(",")) { const [sur, giv] = n.split(",").map((x) => x.trim()); n = `${giv} ${sur}`.trim(); }
  return n.split(/\s+/).map((w) => (/^[IVX]+$/.test(w) ? w : w.split("-").map((x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()).join("-"))).join(" ");
};

function Preview({ text, kind }) {
  if (!text) return null;
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-blue">
        Θέμα: <span className="normal-case tracking-normal text-soft-white">{text.subject}</span>
        {CARD_KINDS.includes(kind) && <span className="ml-2 normal-case tracking-normal" style={{ color: GOLD }}>· φεύγει ως κάρτα</span>}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-soft-white/90">{text.body}</p>
    </div>
  );
}

export default function AfterSalesPanel({ departures = [], noCountry = 0, onPeople }) {
  const [cal, setCal] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [flash, setFlash] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [open, setOpen] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/aftersales?days=370", { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status}`);
      setCal(await r.json());
      setErr(null);
    } catch (e) {
      setErr(`Δεν φόρτωσε: ${e.message}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = useCallback(async (payload, key) => {
    setBusy(key); setErr(null); setFlash(null);
    try {
      const r = await fetch("/api/aftersales", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      return j;
    } catch (e) {
      setErr(e.message);
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const today = useMemo(() => (cal?.touches ?? []).filter((t) => ["due", "generated", "waiting", "held"].includes(t.status) && t.due <= cal.today), [cal]);

  // The year ahead, in order: messages, departures, and the lost waves as one
  // row per day (seventy notes on 12 January read as one line, not seventy).
  const ahead = useMemo(() => {
    if (!cal) return [];
    const evs = [];
    const waves = new Map();
    for (const t of cal.touches) {
      if (!(t.status === "upcoming" || ((t.status === "waiting" || t.status === "held") && t.due > cal.today))) continue;
      if (t.kind.startsWith("lost_")) {
        const w = waves.get(t.due) ?? { type: "wave", date: t.due, items: [] };
        w.items.push(t);
        waves.set(t.due, w);
      } else evs.push({ type: "touch", date: t.due, t });
    }
    evs.push(...waves.values());
    for (const dep of departures) if (dep.date >= cal.today) evs.push({ type: "departure", date: dep.date, dep });
    return evs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [cal, departures]);

  const charters = useMemo(() => {
    if (!cal) return [];
    const from = new Date(Date.parse(cal.today) - 21 * 86400000).toISOString().slice(0, 10);
    return cal.charters.filter((c) => (c.problem.on && !c.problem.resolved_at) || ((c.from ?? c.to) <= cal.today && c.to >= from));
  }, [cal]);

  const done = useMemo(() => {
    if (!cal) return [];
    const from = new Date(Date.parse(cal.today) - 30 * 86400000).toISOString().slice(0, 10);
    return cal.touches.filter((t) => (t.status === "sent" || t.status === "skipped") && (t.state?.at ?? t.due).slice(0, 10) >= from).sort((a, b) => ((b.state?.at ?? b.due) < (a.state?.at ?? a.due) ? -1 : 1));
  }, [cal]);

  const lostByCat = useMemo(() => {
    const m = {};
    for (const l of cal?.lost ?? []) m[l.lost.category] = (m[l.lost.category] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [cal]);

  async function generate(t) {
    const j = await post({ action: "generate", id: t.id }, t.id);
    if (j?.generated) setDrafts((d) => ({ ...d, [t.id]: { subject: j.generated.subject, body: j.generated.body, warnings: j.generated.warnings ?? [], recent: j.generated.recent_inbound } }));
  }
  async function send(t, test = false) {
    const d = drafts[t.id] ?? (t.state?.subject ? { subject: t.state.subject, body: t.state.body ?? "" } : null);
    if (!d) return;
    const live = cal?.mode === "live" && !test;
    if (live && !window.confirm(`Να σταλεί τώρα στον/στην ${t.person.first_name} (${t.person.email});`)) return;
    const j = await post({ action: "send", id: t.id, subject: d.subject, body: d.body, test }, t.id);
    if (j?.ok) {
      setFlash(j.test ? `Δοκιμή: ήρθε σε σένα (${j.sent_to}). Το κανονικό μένει ανοιχτό.` : `Στάλθηκε στον/στην ${t.person.first_name}.`);
      if (!j.test) setDrafts((x) => { const n = { ...x }; delete n[t.id]; return n; });
      await load();
    }
  }
  async function skip(t) {
    const reason = window.prompt("Γιατί το παραλείπεις; (προαιρετικό)", "");
    if (reason === null) return;
    if (await post({ action: "skip", id: t.id, reason: reason || "το παρέλειψες" }, t.id)) await load();
  }
  async function rename(p) {
    const n = window.prompt(`Πώς τον/την λες; (σήμερα: ${p.first_name})`, p.first_name);
    if (n === null) return;
    if (await post({ action: "name", email: p.email, first_name: n }, p.email)) { setDrafts({}); await load(); }
  }
  async function problem(c) {
    const note = window.prompt("Τι έγινε; Μία γραμμή, π.χ. «πλημμύριζαν τα ντους στη μία καμπίνα» (προαιρετικό)", "");
    if (note === null) return;
    if (await post({ action: "problem", charter_key: c.key, note }, c.key)) { setFlash(`Το αίτημα κριτικής για ${c.vessel} σταμάτησε για όλους. Όταν λυθεί, πάτα «Λύθηκε».`); await load(); }
  }
  async function resolve(c) {
    const note = window.prompt("Πώς λύθηκε; Γράψε το πρόβλημα όπως θες να το αναφέρει το μήνυμα (προαιρετικό)", c.problem.note);
    if (note === null) return;
    if (await post({ action: "resolve", charter_key: c.key, note }, c.key)) { setFlash("Ωραία. Τα προσωπικά μηνύματα κριτικής εμφανίζονται στο «Σήμερα»."); await load(); }
  }
  async function clearProblem(c) {
    if (!window.confirm("Να ακυρωθεί το «Κάτι πήγε στραβά»; (π.χ. πατήθηκε κατά λάθος)")) return;
    if (await post({ action: "clear_problem", charter_key: c.key }, c.key)) await load();
  }
  async function setMode(m) {
    if (m === "live" && !window.confirm("Ζωντανή λειτουργία: το Send θα στέλνει πια στους πελάτες. Συνέχεια;")) return;
    if (await post({ action: "mode", mode: m }, "mode")) await load();
  }

  const charterOf = (key) => [...(cal?.charters ?? []), ...(cal?.lost ?? [])].find((c) => c.key === key);

  // A plain render function, not a nested component: a nested component would
  // remount on every keystroke and the text box would lose focus.
  const renderToday = (t) => {
    const d = drafts[t.id] ?? (t.state?.subject ? { subject: t.state.subject, body: t.state.body ?? "", warnings: t.state.warnings ?? [] } : null);
    const c = charterOf(t.charter_key);
    return (
      <div key={t.id} className={CARD}>
        <div className="flex flex-wrap items-center gap-4">
          <DateBlock iso={t.due} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-soft-white">
              {nameOf(t.person)}{" "}
              <button onClick={() => rename(t.person)} className="ml-1 text-xs font-normal text-muted-blue underline decoration-white/20 underline-offset-2 hover:text-soft-white">
                τον λες «{t.person.first_name}»
              </button>
            </p>
            <p className="mt-0.5 text-sm text-muted-blue">
              {t.kind_el}{t.vessel ? ` · ${t.vessel}` : ""} · {ROLE_EL[t.person.role] ?? ""}
              {c?.lost?.reason_text ? ` · ${c.lost.reason_text.replace(/^\[[a-z]+\]\s*/, "")}` : ""}
            </p>
            <p className="text-xs text-muted-blue/70">{t.person.email}</p>
          </div>
          {t.status === "waiting" || t.status === "held" ? (
            <Chip tone="warn">{t.reason_el}</Chip>
          ) : (
            <div className="flex gap-2">
              <button className={BTN_GOLD} style={{ background: GOLD }} disabled={busy === t.id} onClick={() => generate(t)}>
                {busy === t.id ? "Γράφεται…" : d ? "Ξανά Generate" : "Generate"}
              </button>
              <button className={BTN_GHOST} disabled={busy === t.id} onClick={() => skip(t)}>Παράλειψε</button>
            </div>
          )}
        </div>
        {!d && t.status !== "waiting" && t.status !== "held" && <Preview text={t.preview} kind={t.kind} />}
        {d && t.status !== "waiting" && t.status !== "held" && (
          <div className="mt-4 space-y-3">
            {drafts[t.id]?.recent && (
              <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-soft-white">
                Σου έγραψε στις {fmt(drafts[t.id].recent.at)}: «{drafts[t.id].recent.snippet}». Διάβασέ το πριν στείλεις.
              </p>
            )}
            {d.warnings?.length ? <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-soft-white">Έλεγχος: {d.warnings.join(" · ")}</p> : null}
            {t.state?.test_sent_at && <p className="text-xs text-muted-blue">Δοκιμή ήρθε σε σένα στις {fmt(t.state.test_sent_at)}.</p>}
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-blue">Θέμα</p>
              <input className={INPUT} value={d.subject} onChange={(e) => setDrafts((x) => ({ ...x, [t.id]: { ...d, subject: e.target.value } }))} />
            </div>
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-blue">
                Κείμενο{CARD_KINDS.includes(t.kind) && <span className="ml-2 normal-case tracking-normal" style={{ color: GOLD }}>· φεύγει ως κάρτα, με την υπογραφή σου</span>}
              </p>
              <textarea className={INPUT} style={{ minHeight: 240 }} value={d.body} onChange={(e) => setDrafts((x) => ({ ...x, [t.id]: { ...d, body: e.target.value } }))} />
            </div>
            <div className="flex justify-end gap-2">
              {cal.mode === "live" && (
                <button className={BTN_GHOST} disabled={busy === t.id} onClick={() => send(t, true)} title="Έρχεται μόνο σε σένα, για να το δεις όπως θα το δει ο πελάτης">Δοκιμή σε μένα</button>
              )}
              <button className={BTN_GOLD} style={{ background: GOLD }} disabled={busy === t.id} onClick={() => send(t)}>
                {busy === t.id ? "Στέλνεται…" : cal.mode === "live" ? "Send" : "Send (δοκιμή σε σένα)"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!cal) {
    return err ? <p className="text-sm text-hot-red">{err}</p> : (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
        <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
      </div>
    );
  }

  // Only clients get the holiday letter, so only a client without a country
  // matters here (the Lighthouse's own count includes every lead).
  const clientsNoCountry = cal.charters.flatMap((c) => c.people).filter((p) => p.role !== "advisor" && !p.country);
  const actionable = today.filter((t) => t.status === "due" || t.status === "generated").length;

  return (
    <div className="space-y-2.5">
      {cal.mode === "test" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-soft-white">
          <span><b>Δοκιμαστική λειτουργία.</b> Κάθε Send έρχεται μόνο σε σένα, με [ΔΟΚΙΜΗ] στο θέμα.</span>
          <button className={BTN_GHOST} disabled={busy === "mode"} onClick={() => setMode("live")}>Πέρνα σε ζωντανή</button>
        </div>
      )}
      {clientsNoCountry.length > 0 && (
        <button onClick={onPeople} className="block w-full rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-left text-sm text-soft-white hover:bg-amber-400/15">
          ⚠️ {clientsNoCountry.length} {clientsNoCountry.length === 1 ? "πελάτης" : "πελάτες"} χωρίς χώρα ({clientsNoCountry.map((p) => p.first_name).join(", ")}). Χωρίς χώρα, το γιορτινό γράμμα πάει ως Thanksgiving. Πάτα εδώ και συμπλήρωσέ τους.
        </button>
      )}
      {flash && <p className="rounded-xl bg-emerald/15 p-3 text-sm text-emerald">{flash}</p>}
      {err && <p className="rounded-xl bg-hot-red/15 p-3 text-sm text-hot-red">{err}</p>}

      {/* Today */}
      <p className="pt-2 text-[11px] font-bold uppercase tracking-[3px]" style={{ color: GOLD }}>Σήμερα · {actionable}</p>
      {today.length === 0 && <div className={CARD}><p className="text-sm text-muted-blue">Τίποτα για σήμερα.</p></div>}
      {today.map((t) => renderToday(t))}

      {/* Charters: the one switch that stops the review ask */}
      {charters.length > 0 && (
        <>
          <p className="pt-5 text-[11px] font-bold uppercase tracking-[3px]" style={{ color: GOLD }}>Ναυλώσεις</p>
          <p className="text-xs text-muted-blue">Αν κάτι πήγε στραβά, πάτα «Κάτι πήγε στραβά»: το αίτημα κριτικής σταματά για όλους. Όταν λυθεί, «Λύθηκε», και ετοιμάζεται προσωπικό μήνυμα για τον καθένα.</p>
          {charters.map((c) => (
            <div key={c.key} className={CARD}>
              <div className="flex flex-wrap items-center gap-4">
                <DateBlock iso={c.to} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-soft-white">⛵ {c.vessel}</p>
                  <p className="mt-0.5 text-sm text-muted-blue">
                    {fmt(c.from)} έως {fmt(c.to)} ·{" "}
                    {c.white_label ? "white label, δεν γράφουμε σε κανέναν" : c.via_advisor ? "μέσω advisor, γράφουμε μόνο στον advisor" : c.people.map((p) => p.first_name).join(", ") || "κανείς με email ακόμα"}
                  </p>
                  {c.problem.on && (
                    <p className="mt-1 text-xs text-muted-blue">
                      {c.problem.note ? <>«{c.problem.note}» · </> : null}
                      <button onClick={() => clearProblem(c)} className="underline decoration-white/20 underline-offset-2 hover:text-soft-white">πατήθηκε κατά λάθος</button>
                    </p>
                  )}
                </div>
                {!c.via_advisor && !c.white_label && (
                  !c.problem.on ? (
                    <button className={BTN_GHOST} disabled={busy === c.key} onClick={() => problem(c)}>Κάτι πήγε στραβά</button>
                  ) : c.problem.resolved_at ? (
                    <Chip tone="good">Λύθηκε {fmt(c.problem.resolved_at)}</Chip>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Chip tone="bad">Σε αναμονή{c.problem.overdue ? " πάνω από 10 μέρες" : ""}</Chip>
                      <button className={BTN_GOLD} style={{ background: GOLD }} disabled={busy === c.key} onClick={() => resolve(c)}>Λύθηκε</button>
                    </div>
                  )
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {/* The year ahead */}
      <p className="pt-5 text-[11px] font-bold uppercase tracking-[3px]" style={{ color: GOLD }}>Έρχονται</p>
      {ahead.length === 0 && <div className={CARD}><p className="text-sm text-muted-blue">Τίποτα τους επόμενους μήνες.</p></div>}
      {ahead.map((ev) => {
        if (ev.type === "departure") {
          const dep = ev.dep;
          return (
            <div key={"d" + dep.person.key + dep.date} className="rounded-2xl border border-white/10 bg-deep-space/40 p-4">
              <div className="flex items-center gap-4">
                <DateBlock iso={dep.date} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-soft-white">⛵ {dep.person.name} σαλπάρει</p>
                  <p className="mt-0.5 truncate text-sm text-muted-blue">{dep.to && dep.to > dep.date ? `έως ${fmt(dep.to)}` : ""}</p>
                </div>
                <Chip>Ναύλος</Chip>
              </div>
            </div>
          );
        }
        if (ev.type === "wave") {
          const k = "w" + ev.date;
          const counts = {};
          for (const t of ev.items) counts[t.kind_el] = (counts[t.kind_el] ?? 0) + 1;
          return (
            <div key={k} className={CARD}>
              <div className="flex flex-wrap items-center gap-4">
                <DateBlock iso={ev.date} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-soft-white">Οι χαμένοι · {ev.items.length} προσωπικά σημειώματα</p>
                  <p className="mt-0.5 text-sm text-muted-blue">{Object.entries(counts).map(([kk, n]) => `${kk.replace("Χαμένο: ", "")} ${n}`).join(" · ")}</p>
                </div>
                <button className={BTN_GHOST} onClick={() => setOpen(open === k ? null : k)}>{open === k ? "Κλείσε" : "Ποιοι"}</button>
              </div>
              {open === k && (
                <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
                  {ev.items.map((t) => (
                    <div key={t.id}>
                      <button onClick={() => setOpen(k + "|" + t.id)} className="text-left text-sm text-muted-blue hover:text-soft-white">
                        {nameOf(t.person)} · {t.kind_el.replace("Χαμένο: ", "")} · {t.person.email}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {String(open).startsWith(k + "|") && (() => {
                const t = ev.items.find((x) => open === k + "|" + x.id);
                return t ? (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <button onClick={() => setOpen(k)} className="text-xs text-muted-blue underline decoration-white/20 underline-offset-2">← όλοι</button>
                    <p className="mt-2 text-sm font-semibold text-soft-white">{nameOf(t.person)}</p>
                    <Preview text={t.preview} kind={t.kind} />
                  </div>
                ) : null;
              })()}
            </div>
          );
        }
        const t = ev.t;
        return (
          <div key={t.id} className={CARD}>
            <div className="flex flex-wrap items-center gap-4">
              <DateBlock iso={t.due} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-soft-white">{nameOf(t.person)}</p>
                <p className="mt-0.5 text-sm text-muted-blue">{t.kind_el}{t.vessel ? ` · ${t.vessel}` : ""}{t.reason_el ? ` · ${t.reason_el}` : ""}</p>
              </div>
              <button className={BTN_GHOST} onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Κλείσε" : "Δες το κείμενο"}</button>
            </div>
            {open === t.id && <Preview text={t.preview} kind={t.kind} />}
          </div>
        );
      })}

      {lostByCat.length > 0 && (
        <p className="pt-1 text-xs text-muted-blue">
          Χαμένοι στη λίστα: {lostByCat.map(([k, n]) => `${LOST_EL[k] ?? k} ${n}`).join(" · ")}. Το πολύ δύο σημειώματα σε δώδεκα μήνες, και μετά τέλος.
        </p>
      )}

      {/* Done */}
      {done.length > 0 && (
        <>
          <button onClick={() => setShowDone(!showDone)} className="pt-5 text-[11px] font-bold uppercase tracking-[3px]" style={{ color: GOLD }}>
            Έγιναν τις τελευταίες 30 μέρες · {done.length} {showDone ? "▴" : "▾"}
          </button>
          {showDone && done.map((t) => (
            <div key={t.id} className="rounded-2xl border border-white/10 bg-deep-space/40 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-soft-white">{fmt(t.state?.at ?? t.due)} · {t.kind_el} · {nameOf(t.person)}</span>
                <span className="flex items-center gap-2 text-muted-blue">
                  {t.reason_el}
                  {t.status === "skipped" && t.state && (
                    <button className="underline decoration-white/20 underline-offset-2" onClick={async () => { if (await post({ action: "unskip", id: t.id }, t.id)) await load(); }}>επαναφορά</button>
                  )}
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      <p className="pt-6 text-xs italic text-muted-blue">
        Κανόνες: ένα μήνυμα τη μέρα σε κάθε άνθρωπο, 14 μέρες απόσταση για τις ευχές, ένα γιορτινό γράμμα τον χρόνο ανάλογα με τη χώρα, ποτέ στον πελάτη ενός advisor, μόνο Google για τις κριτικές. Τίποτα δεν φεύγει χωρίς το Send σου.
        {cal.mode === "live" && (
          <> <button className="underline decoration-white/20 underline-offset-2" disabled={busy === "mode"} onClick={() => setMode("test")}>Δοκιμαστική λειτουργία</button></>
        )}
      </p>
    </div>
  );
}
