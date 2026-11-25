"use client";

// After sales (25/11/2026). One page: what is due today, the charters with the
// "Κάτι πήγε στραβά" switch, what comes next, what was done. Generate prepares
// the email, George reads it, Send sends it. In test mode Send goes to george@.

import { useCallback, useEffect, useMemo, useState } from "react";

const GOLD = "#DAA110";

type Person = { email: string; first_name: string; name_source: "george" | "record"; full_name: string; role: "lead" | "guest" | "advisor"; dob: string | null; country: string | null };
type Charter = {
  key: string; vessel: string; from: string | null; to: string; area: string | null; port_to: string | null;
  via_advisor: boolean; white_label: boolean; people: Person[];
  problem: { on: boolean; note: string; at: string | null; resolved_at: string | null; overdue: boolean };
};
type TouchState = { status: string; subject?: string; body?: string; warnings?: string[]; test_sent_at?: string; at: string };
type Touch = {
  id: string; kind: string; kind_el: string; charter_key: string; vessel: string; person: Person;
  due: string; expires: string; status: "due" | "upcoming" | "held" | "waiting" | "generated" | "sent" | "skipped"; reason_el: string; state: TouchState | null;
};
type Lost = Charter & { lost: { category: string; lost_at: string; reason_text: string; dates_from: string | null } };
type Cal = { today: string; mode: "test" | "live"; charters: Charter[]; lost: Lost[]; touches: Touch[] };
const LOST_EL: Record<string, string> = { budget: "Budget", silence: "Σιωπή", short: "Ήθελε λίγες μέρες", dates: "Ημερομηνίες", plans: "Άλλαξαν σχέδια", broker: "Άλλος broker", personal: "Προσωπικοί λόγοι" };

const ROLE_EL: Record<Person["role"], string> = { lead: "βασικός πελάτης", guest: "επιβάτης", advisor: "advisor" };
const fmt = (iso: string | null) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("el-GR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

export default function AfterSalesClient() {
  const [cal, setCal] = useState<Cal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string; warnings: string[]; recent?: { at: string; snippet: string } | null }>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/aftersales", { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status}`);
      setCal(await r.json());
    } catch (e) {
      setErr(`Δεν φόρτωσε: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = useCallback(async (payload: Record<string, unknown>, key: string) => {
    setBusy(key); setErr(null); setFlash(null);
    try {
      const r = await fetch("/api/aftersales", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      return j;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const today = useMemo(() => (cal?.touches ?? []).filter((t) => ["due", "generated", "waiting"].includes(t.status)), [cal]);
  const upcoming = useMemo(() => (cal?.touches ?? []).filter((t) => t.status === "upcoming" && !t.kind.startsWith("lost_")).slice(0, 40), [cal]);
  const lostWaves = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of cal?.touches ?? []) if (t.kind.startsWith("lost_") && t.status === "upcoming") m.set(t.due, (m.get(t.due) ?? 0) + 1);
    return [...m.entries()].sort();
  }, [cal]);
  const lostByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of cal?.lost ?? []) m[l.lost.category] = (m[l.lost.category] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [cal]);
  const done = useMemo(() => (cal?.touches ?? []).filter((t) => t.status === "sent" || t.status === "skipped").slice(-20).reverse(), [cal]);
  const charters = useMemo(() => {
    if (!cal) return [];
    const cut = new Date(Date.parse(cal.today) - 400 * 86400000).toISOString().slice(0, 10);
    return cal.charters.filter((c) => c.to >= cut);
  }, [cal]);

  async function generate(t: Touch) {
    const j = await post({ action: "generate", id: t.id }, t.id);
    if (j?.generated) setDrafts((d) => ({ ...d, [t.id]: { subject: j.generated.subject, body: j.generated.body, warnings: j.generated.warnings ?? [], recent: j.generated.recent_inbound } }));
  }
  async function send(t: Touch) {
    const d = drafts[t.id] ?? (t.state?.subject ? { subject: t.state.subject, body: t.state.body ?? "", warnings: [] } : null);
    if (!d) return;
    const live = cal?.mode === "live";
    if (live && !window.confirm(`Να σταλεί τώρα στον/στην ${t.person.first_name} (${t.person.email});`)) return;
    const j = await post({ action: "send", id: t.id, subject: d.subject, body: d.body }, t.id);
    if (j?.ok) { setFlash(j.test ? `Δοκιμή: στάλθηκε σε σένα (${j.sent_to}). Το κανονικό μένει ανοιχτό.` : `Στάλθηκε στον/στην ${t.person.first_name}.`); await load(); }
  }
  async function skip(t: Touch) {
    const reason = window.prompt("Γιατί το παραλείπεις; (προαιρετικό)", "") ?? null;
    if (reason === null) return;
    if (await post({ action: "skip", id: t.id, reason: reason || "το παρέλειψες" }, t.id)) await load();
  }
  async function rename(p: Person) {
    const n = window.prompt(`Πώς τον/την λες; (σήμερα: ${p.first_name})`, p.first_name);
    if (n === null) return;
    if (await post({ action: "name", email: p.email, first_name: n }, p.email)) { setDrafts({}); await load(); }
  }
  async function problem(c: Charter) {
    const note = window.prompt("Τι έγινε; Μία γραμμή, π.χ. «πλημμύριζαν τα ντους στη μία καμπίνα» (προαιρετικό)", "");
    if (note === null) return;
    if (await post({ action: "problem", charter_key: c.key, note }, c.key)) { setFlash(`Το αίτημα κριτικής για ${c.vessel} σταμάτησε. Όταν λυθεί, πάτα «Λύθηκε».`); await load(); }
  }
  async function resolve(c: Charter) {
    const note = window.prompt("Πώς λύθηκε; Γράψε το πρόβλημα όπως θες να το αναφέρει το μήνυμα (προαιρετικό)", c.problem.note);
    if (note === null) return;
    if (await post({ action: "resolve", charter_key: c.key, note }, c.key)) { setFlash("Ωραία. Τα προσωπικά μηνύματα κριτικής ετοιμάζονται στο «Σήμερα»."); await load(); }
  }
  async function clearProblem(c: Charter) {
    if (!window.confirm("Να ακυρωθεί το «Κάτι πήγε στραβά»; (π.χ. πατήθηκε κατά λάθος)")) return;
    if (await post({ action: "clear_problem", charter_key: c.key }, c.key)) await load();
  }
  async function setMode(m: "test" | "live") {
    const ok = m === "live"
      ? window.confirm("Ζωντανή λειτουργία: το Send θα στέλνει πια στους επιβάτες. Συνέχεια;")
      : true;
    if (!ok) return;
    if (await post({ action: "mode", mode: m }, "mode")) await load();
  }

  if (!cal) return <div className="mx-auto max-w-3xl p-6 sm:p-10 text-muted-blue">{err ?? "Φορτώνει…"}</div>;

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-10">
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[4px]" style={{ color: GOLD }}>After sales</p>
        <h1 className="mt-1 font-[family-name:var(--font-serif,Georgia)] text-3xl text-soft-white">Μετά τη ναύλωση</h1>
        <p className="mt-2 text-sm text-muted-blue">
          Ευχαριστώ, κριτική Google, γενέθλια, το γιορτινό γράμμα, η επέτειος και η νέα σεζόν. Το σύστημα τα ετοιμάζει, εσύ πατάς Send.
        </p>
      </div>

      <div style={{ ...box, borderColor: cal.mode === "live" ? "rgba(58,107,71,0.5)" : "rgba(218,161,16,0.6)" }}>
        <div style={row}>
          <div style={{ fontSize: 13, color: "#0D1B2A" }}>
            {cal.mode === "live"
              ? <><b>Ζωντανή λειτουργία.</b> Το Send στέλνει στον επιβάτη.</>
              : <><b>Δοκιμαστική λειτουργία.</b> Κάθε Send έρχεται μόνο σε σένα, με [ΔΟΚΙΜΗ] στο θέμα. Κανένας επιβάτης δεν παίρνει τίποτα.</>}
          </div>
          <button style={ghostBtn} disabled={busy === "mode"} onClick={() => setMode(cal.mode === "live" ? "test" : "live")}>
            {cal.mode === "live" ? "Πίσω σε δοκιμή" : "Πέρνα σε ζωντανή"}
          </button>
        </div>
      </div>

      <p style={{ fontSize: 13, color: "#0D1B2A", background: "#FFFBEB", border: "1px solid rgba(218,161,16,0.45)", padding: "8px 12px", marginTop: 12 }}>
        Από 25/11/2026 όλα αυτά δουλεύουν από το <a href="/dashboard/lighthouse" style={{ color: "#7a6224", textDecoration: "underline" }}>Lighthouse</a>. Αυτή η σελίδα μένει ως αρχείο.
      </p>
      {flash && <p style={{ color: "#8FD19E", fontSize: 13, marginTop: 12 }}>{flash}</p>}
      {err && <p style={{ color: "#F87171", fontSize: 13, marginTop: 12 }}>{err}</p>}

      <h2 style={h2}>Σήμερα · {today.filter((t) => t.status !== "waiting").length}</h2>
      {!today.length && <p className="text-sm text-muted-blue">Τίποτα για σήμερα.</p>}
      {today.map((t) => {
        const d = drafts[t.id] ?? (t.state?.subject ? { subject: t.state.subject, body: t.state.body ?? "", warnings: t.state.warnings ?? [] } : null);
        return (
          <div key={t.id} style={box}>
            <div style={row}>
              <div>
                <div style={label}>{t.kind_el} · {fmt(t.due)}</div>
                <div style={{ fontSize: 15, color: "#0D1B2A" }}>
                  <b>{t.person.first_name}</b>{" "}
                  <button style={link} onClick={() => rename(t.person)} title="Άλλαξε το όνομα που χρησιμοποιούμε">αλλαγή ονόματος</button>
                  <span style={{ color: "#6b7280", fontSize: 12.5 }}> · {ROLE_EL[t.person.role]} · {t.vessel} · {t.person.email}</span>
                </div>
              </div>
              {t.status === "waiting" ? <span style={chip}>{t.reason_el}</span> : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={ghostBtn} disabled={busy === t.id} onClick={() => generate(t)}>{d ? "Ξανά Generate" : "Generate"}</button>
                  <button style={ghostBtn} disabled={busy === t.id} onClick={() => skip(t)}>Παράλειψε</button>
                </div>
              )}
            </div>
            {d && t.status !== "waiting" && (
              <div style={{ marginTop: 12 }}>
                {drafts[t.id]?.recent && <p style={warn}>Σου έγραψε στις {fmt(drafts[t.id]!.recent!.at)}: «{drafts[t.id]!.recent!.snippet}». Διάβασέ το πριν στείλεις.</p>}
                {d.warnings?.length ? <p style={warn}>Έλεγχος: {d.warnings.join(" · ")}</p> : null}
                {t.state?.test_sent_at && <p style={{ ...warn, borderColor: "rgba(13,27,42,0.15)", color: "#374151" }}>Δοκιμή ήρθε σε σένα στις {fmt(t.state.test_sent_at)}.</p>}
                <div style={label}>Θέμα</div>
                <input style={input} value={d.subject} onChange={(e) => setDrafts((x) => ({ ...x, [t.id]: { ...d, subject: e.target.value } }))} />
                <div style={{ ...label, marginTop: 10 }}>Κείμενο</div>
                <textarea style={{ ...input, minHeight: 230 }} value={d.body} onChange={(e) => setDrafts((x) => ({ ...x, [t.id]: { ...d, body: e.target.value } }))} />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                  <button style={primaryBtn} disabled={busy === t.id} onClick={() => send(t)}>{cal.mode === "live" ? "Send" : "Send (δοκιμή σε σένα)"}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <h2 style={h2}>Ναυλώσεις</h2>
      <p className="text-sm text-muted-blue" style={{ marginBottom: 6 }}>
        Αν κάτι πήγε στραβά σε μια ναύλωση, πάτα «Κάτι πήγε στραβά». Το τυποποιημένο αίτημα κριτικής σταματά για όλους. Όταν λυθεί, πάτα «Λύθηκε» και το σύστημα ετοιμάζει το προσωπικό σου μήνυμα για τον καθένα.
      </p>
      {charters.map((c) => (
        <div key={c.key} style={box}>
          <div style={row}>
            <div>
              <div style={label}>{fmt(c.from)} έως {fmt(c.to)}{c.area && c.area.length <= 40 ? ` · ${c.area}` : ""}</div>
              <div style={{ fontSize: 15, color: "#0D1B2A" }}><b>{c.vessel}</b></div>
              <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 2 }}>
                {c.white_label ? "White label: δεν γράφουμε σε κανέναν." :
                  c.via_advisor ? `Μέσω advisor: γράφουμε μόνο στον advisor (${c.people[0]?.email ?? "χωρίς email"}).` :
                  c.people.length ? c.people.map((p) => p.first_name).join(", ") : "Κανένας επιβάτης με email ακόμα (συμπληρώνουν στο The Cabin)."}
              </div>
            </div>
            {!c.via_advisor && !c.white_label && (
              !c.problem.on ? (
                <button style={ghostBtn} disabled={busy === c.key} onClick={() => problem(c)}>Κάτι πήγε στραβά</button>
              ) : c.problem.resolved_at ? (
                <span style={chip}>Λύθηκε {fmt(c.problem.resolved_at)} · προσωπικά μηνύματα</span>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ ...chip, borderColor: "rgba(185,28,28,0.4)", color: "#b91c1c" }}>Σε αναμονή{c.problem.overdue ? " πάνω από 10 μέρες" : ""}</span>
                  <button style={primaryBtn} disabled={busy === c.key} onClick={() => resolve(c)}>Λύθηκε</button>
                </div>
              )
            )}
          </div>
          {c.problem.on && (
            <div style={{ fontSize: 12.5, color: "#374151", marginTop: 8 }}>
              {c.problem.note ? <>«{c.problem.note}» · </> : null}
              <button style={link} onClick={() => clearProblem(c)}>πατήθηκε κατά λάθος</button>
            </div>
          )}
        </div>
      ))}

      <h2 style={h2}>Οι χαμένοι · {cal.lost?.length ?? 0}</h2>
      <p className="text-sm text-muted-blue" style={{ marginBottom: 6 }}>
        Όσοι ρώτησαν και δεν έκλεισαν. Ένα προσωπικό σημείωμα ανάλογα με το γιατί χάθηκαν, το πολύ δύο σε δώδεκα μήνες, και μετά τέλος. Δεν γράφουμε σε όσους ήταν εκτός αντικειμένου, σε πελάτες advisor ή σε όποιον έκλεισε στο μεταξύ.
      </p>
      <div style={box}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {lostByCat.map(([k, n]) => <span key={k} style={chip}>{LOST_EL[k] ?? k}: {n}</span>)}
        </div>
        <div style={{ fontSize: 13, color: "#0D1B2A", marginTop: 10 }}>
          {lostWaves.length ? lostWaves.map(([d, n]) => <div key={d}>{fmt(d)}: <b>{n}</b> σημειώματα έτοιμα για Generate εκείνη τη μέρα</div>) : "Κανένα σημείωμα τις επόμενες εβδομάδες."}
        </div>
      </div>

      <h2 style={h2}>Έρχονται</h2>
      {!upcoming.length && <p className="text-sm text-muted-blue">Τίποτα τις επόμενες εβδομάδες.</p>}
      {upcoming.map((t) => (
        <div key={t.id} style={{ ...box, padding: "9px 14px" }}>
          <div style={{ fontSize: 13, color: "#0D1B2A" }}>{fmt(t.due)} · <b>{t.kind_el}</b> · {t.person.first_name} · <span style={{ color: "#6b7280" }}>{t.vessel}</span></div>
        </div>
      ))}

      {!!done.length && <h2 style={h2}>Έγιναν</h2>}
      {done.map((t) => (
        <div key={t.id} style={{ ...box, padding: "9px 14px", opacity: 0.8 }}>
          <div style={row}>
            <div style={{ fontSize: 13, color: "#0D1B2A" }}>{fmt(t.state?.at ?? t.due)} · {t.kind_el} · {t.person.first_name} · {t.reason_el}</div>
            {t.status === "skipped" && t.state && <button style={link} onClick={async () => { if (await post({ action: "unskip", id: t.id }, t.id)) await load(); }}>επαναφορά</button>}
          </div>
        </div>
      ))}

      <p className="text-xs text-muted-blue" style={{ marginTop: 24, fontStyle: "italic" }}>
        Κανόνες: ένα μήνυμα τη μέρα σε κάθε άνθρωπο, 14 μέρες απόσταση για τα μηνύματα που κρατούν τη σχέση ζεστή, ποτέ στον πελάτη ενός advisor, μόνο Google για τις κριτικές. Το πρωινό σου email λέει πόσα έχεις σήμερα.
      </p>
    </div>
  );
}

const box: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 10 };
const row: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const label: React.CSSProperties = { fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#6b7280", marginBottom: 4 };
const h2: React.CSSProperties = { fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: GOLD, marginTop: 30, marginBottom: 4, fontWeight: 700 };
const input: React.CSSProperties = { width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13.5, fontFamily: "inherit", lineHeight: 1.55, color: "#0D1B2A", background: "#fff" };
const primaryBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "8px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const chip: React.CSSProperties = { fontSize: 11, padding: "3px 9px", border: "1px solid rgba(201,168,76,0.45)", color: "#7a6224", borderRadius: 10 };
const warn: React.CSSProperties = { fontSize: 12.5, color: "#92400e", border: "1px solid rgba(218,161,16,0.45)", padding: "7px 10px", marginBottom: 10, background: "#FFFBEB" };
const link: React.CSSProperties = { background: "none", border: "none", padding: 0, color: "#7a6224", fontSize: 11.5, textDecoration: "underline", cursor: "pointer" };
