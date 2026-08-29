// @ts-nocheck
"use client";

import { useEffect, useMemo, useState } from "react";

// THE LIGHTHOUSE — George's brief (29/8): "σαν iPhone, σαν Apple:
// απλό, όμορφο, και να κάνει όλες τις δουλειές". So: one column,
// generous space, large friendly type, three panels only (Επερχόμενα,
// Άνθρωποι, Έγγραφα), and every action a single obvious button.
// Deliberately calmer than the rest of GY Command.

const GOLD = "#DAA110";

function Chip({ children, tone = "neutral" }) {
  const map = {
    good: "bg-emerald/15 text-emerald",
    warn: "bg-amber/15 text-amber",
    bad: "bg-hot-red/15 text-hot-red",
    gold: "bg-[#DAA110]/15 text-[#DAA110]",
    neutral: "bg-white/10 text-muted-blue",
  };
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-[11px] font-semibold ${map[tone]}`}>
      {children}
    </span>
  );
}

function fmtDay(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "long" });
}

const FLAGS = {
  "united states": "🇺🇸", usa: "🇺🇸", american: "🇺🇸", "united kingdom": "🇬🇧", uk: "🇬🇧",
  greece: "🇬🇷", greek: "🇬🇷", canada: "🇨🇦", australia: "🇦🇺", germany: "🇩🇪", france: "🇫🇷",
  italy: "🇮🇹", spain: "🇪🇸", israel: "🇮🇱", "united arab emirates": "🇦🇪", "saudi arabia": "🇸🇦",
  russia: "🇷🇺", netherlands: "🇳🇱", switzerland: "🇨🇭", ireland: "🇮🇪", mexico: "🇲🇽", brazil: "🇧🇷",
};
function flagOf(country) {
  const c = String(country || "").toLowerCase();
  for (const [k, v] of Object.entries(FLAGS)) if (c.includes(k)) return v;
  return "";
}

const KIND_GR = {
  birthday: "Γενέθλια",
  anniversary: "Επέτειος",
  charter_anniversary: "Επέτειος ναύλου",
  custom: "Ημερομηνία",
};

export default function LighthouseClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("upcoming");
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");
  const [openDraft, setOpenDraft] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  // Passport reader state.
  const [reading, setReading] = useState(false);
  const [extracted, setExtracted] = useState(null);
  const [passportFile, setPassportFile] = useState(null);
  const [keepFile, setKeepFile] = useState(true);
  const [targetKey, setTargetKey] = useState("");
  const [ppMode, setPpMode] = useState("new"); // "new" client or attach to "existing"
  const [ppForm, setPpForm] = useState({ name: "", date_of_birth: "", nationality: "", email: "", phone: "" });
  const [suggestions, setSuggestions] = useState([]);
  const [ctReading, setCtReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ctFields, setCtFields] = useState(null);
  const [ctFile, setCtFile] = useState(null);
  const [ctTarget, setCtTarget] = useState("");

  async function load() {
    setLoading(true);
    try {
      const d = await fetch("/api/lighthouse?days=30").then((r) => r.json());
      setData(d);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function say(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function act(body) {
    const r = await fetch("/api/lighthouse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.error) say(`Κάτι πήγε στραβά: ${d.error}`);
    return d;
  }

  async function markSent(o) {
    setBusyKey(o.key);
    await act({
      action: "mark_sent",
      key: o.occasion_key,
      contact_id: o.person.contact_id,
      kind: o.kind,
      label: `${KIND_GR[o.kind] ?? o.kind} σε ${o.person.name}`,
    });
    setBusyKey(null);
    say(`Γράφτηκε στο ιστορικό: ${o.person.name}`);
    load();
  }

  async function approveBatch(h) {
    const yes = window.confirm(
      `Να φύγουν οι ευχές «${h.label}» σε ${h.recipients} παραλήπτες;\n\nΚάθε ένας παίρνει προσωπικό email στο όνομά του, από το mail σου. Στέλνεται ΜΙΑ φορά για φέτος.`,
    );
    if (!yes) return;
    setBusyKey(`${h.kind}:${h.date}`);
    const r = await fetch("/api/lighthouse/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: h.kind, date: h.date, confirm: true }),
    });
    const d = await r.json();
    setBusyKey(null);
    if (d.error) say(`Δεν εστάλη: ${d.error}`);
    else say(`Εστάλησαν ${d.sent} από ${d.of} ευχές «${h.label}»`);
    load();
  }

  // A raw phone photo is 8MB of pixels Gemini does not need; 1600px
  // JPEG reads identically and uploads in a breath (George 29/8: "το
  // διαβάζει τρία λεπτά, δεν έχει λογική").
  async function shrinkImage(file) {
    if (!file.type.startsWith("image/")) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 1_500_000) return file;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.82));
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    } catch {
      return file;
    }
  }

  async function readPassport(rawFile) {
    setReading(true);
    setExtracted(null);
    const file = await shrinkImage(rawFile);
    setPassportFile(file);
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/lighthouse/passport", { method: "POST", body: fd });
    const d = await r.json();
    setReading(false);
    if (d.error) return say(`Δεν διαβάστηκε: ${d.error}`);
    setExtracted(d.fields);
    setPpForm({
      name: d.fields.full_name ?? "",
      date_of_birth: d.fields.date_of_birth ?? "",
      nationality: d.fields.nationality ?? "",
      email: "",
      phone: "",
    });
    // George's law (29/8): a passport in his hands means a contract,
    // so the owner is almost always ALREADY in The Helm. Search it
    // first ("πάει και το ψάχνει στο Helm... α, να τος") and attach;
    // a brand-new card is the fallback, never the default.
    const tokens = (d.fields.full_name || "")
      .toLowerCase()
      .split(/[^a-zα-ω]+/)
      .filter((t) => t.length > 2);
    const scored = (data?.people ?? [])
      .map((p) => {
        const pn = p.name.toLowerCase();
        const hits = tokens.filter((t) => pn.includes(t)).length;
        return { p, hits };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits);
    const best = scored[0]?.p;
    setTargetKey(best?.key ?? "");
    setPpMode(best ? "existing" : "new");
    if (best) say(`Α, να τος: ${best.name} από το Helm`);
  }

  // George pressed save three times and nothing on screen answered
  // him (29/8 screenshot). The rule now: the button says what it is
  // doing, the form closes THE MOMENT the save lands, the file copy
  // to the private box happens quietly afterwards, and any error
  // speaks up instead of dying silently.
  function stashFile(file, personName) {
    if (!keepFile || !file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("person", personName);
    fetch("/api/lighthouse/upload", { method: "POST", body: fd }).catch(() => {});
  }

  async function confirmPassport() {
    if (!extracted || saving) return;
    setSaving(true);
    try {
      if (ppMode === "new") {
        const d = await act({
          action: "add_person",
          name: ppForm.name,
          date_of_birth: ppForm.date_of_birth || null,
          nationality: ppForm.nationality || null,
          email: ppForm.email || null,
          phone: ppForm.phone || null,
        });
        if (d.error) return;
        stashFile(passportFile, ppForm.name);
        say(`Αποθηκεύτηκε: νέος πελάτης ${ppForm.name} ✓`);
        setExtracted(null);
        setPassportFile(null);
        load();
        return;
      }
      const person = (data?.people ?? []).find((p) => p.key === targetKey);
      if (!person) return say("Διάλεξε σε ποιον ανήκει το έγγραφο");
      const d = await act({
        action: "apply_document",
        person_key: person.key,
        contact_id: person.contact_id,
        fields: {
          birthday: ppForm.date_of_birth || extracted.date_of_birth,
          country: person.country || ppForm.nationality || extracted.nationality,
        },
      });
      if (d.error) return;
      stashFile(passportFile, person.name);
      say(`Αποθηκεύτηκε στον ${person.name} ✓ (γενέθλια + χώρα)`);
      setExtracted(null);
      setPassportFile(null);
      load();
    } catch (e) {
      say(`Δεν αποθηκεύτηκε: ${String(e?.message ?? e).slice(0, 80)}`);
    } finally {
      setSaving(false);
    }
  }

  async function readContract(rawFile) {
    setCtReading(true);
    setCtFields(null);
    const file = rawFile.type.startsWith("image/") ? await shrinkImage(rawFile) : rawFile;
    setCtFile(file);
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/lighthouse/contract", { method: "POST", body: fd });
    const d = await r.json();
    setCtReading(false);
    if (d.error) return say(`Συμβόλαιο: ${d.error}`);
    if (!d.fields?.charterer_name && !d.fields?.vessel && !d.fields?.date_from) {
      return say("Δεν διαβάστηκαν στοιχεία, δοκίμασε φωτογραφία της πρώτης σελίδας");
    }
    setCtFields(d.fields);
    const tokens = (d.fields.charterer_name || "").toLowerCase().split(/[^a-zα-ω]+/).filter((t) => t.length > 2);
    const best = (data?.people ?? [])
      .map((p) => ({ p, hits: tokens.filter((t) => p.name.toLowerCase().includes(t)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)[0]?.p;
    setCtTarget(best?.key ?? "");
    if (best) say(`Α, να τος: ${best.name}`);
  }

  async function confirmContract() {
    if (!ctFields || saving) return;
    const person = (data?.people ?? []).find((p) => p.key === ctTarget);
    if (!person) return say("Διάλεξε σε ποιον ανήκει το συμβόλαιο");
    setSaving(true);
    try {
      const d = await act({
        action: "apply_document",
        person_key: person.key,
        contact_id: person.contact_id,
        fields: {
          vessel: ctFields.vessel,
          charter_from: ctFields.date_from,
          charter_to: ctFields.date_to,
          won: true,
        },
      });
      if (d.error) return;
      stashFile(ctFile, person.name);
      say(`Αποθηκεύτηκε στον ${person.name} ✓ (${ctFields.vessel ?? "σκάφος"} + ημερομηνίες)`);
      setCtFields(null);
      setCtFile(null);
      load();
    } catch (e) {
      say(`Δεν αποθηκεύτηκε: ${String(e?.message ?? e).slice(0, 80)}`);
    } finally {
      setSaving(false);
    }
  }

  const people = useMemo(() => {
    const q = search.toLowerCase();
    return (data?.people ?? [])
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.email || "").toLowerCase().includes(q))
      .sort((a, b) => (b.won ? 1 : 0) - (a.won ? 1 : 0) || a.name.localeCompare(b.name));
  }, [data, search]);

  const personal = useMemo(
    () =>
      (data?.personal ?? []).map((o) => ({
        ...o,
        key: `${o.person.key}:${o.kind}:${o.date}`,
        occasion_key: `${o.person.key}:${o.kind}:${o.date.slice(0, 4)}`,
        done: !!data?.sent?.[`${o.person.key}:${o.kind}:${o.date.slice(0, 4)}`],
      })),
    [data],
  );

  // One chronological year: the nearest thing first, whatever it is
  // (George 29/8: "ημερολόγιο όλου του έτους... ποια κίνηση γίνεται
  // πιο νωρίς... με σειρά χρόνου, και δίπλα τα άτομα").
  const timeline = useMemo(() => {
    const evs = [];
    for (const h of data?.holidays_year ?? []) evs.push({ type: "holiday", date: h.date, h });
    for (const o of personal) evs.push({ type: "personal", date: o.date, o });
    for (const dep of data?.departures ?? []) evs.push({ type: "departure", date: dep.date, dep });
    return evs.sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [data, personal]);

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-10">
      {/* Header — calm, spacious, Apple-like */}
      <div className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[4px]" style={{ color: GOLD }}>
          The Lighthouse
        </p>
        <h1 className="mt-1 font-[family-name:var(--font-serif,Georgia)] text-3xl text-soft-white">
          Κοντά στους ανθρώπους σου
        </h1>
        <p className="mt-2 text-sm text-muted-blue">
          Γενέθλια, επέτειοι και γιορτές, από το Helm, το Cabin και τα έγγραφα που ανεβάζεις.
          Εσύ στέλνεις, ο φάρος θυμάται.
        </p>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-soft-white px-5 py-2.5 text-sm font-semibold text-deep-space shadow-xl">
          {toast}
        </div>
      )}

      {/* Tabs — three, no more */}
      <div className="mb-6 flex gap-2">
        {[
          ["upcoming", "Επερχόμενα"],
          ["people", "Πελάτες"],
          ["documents", "Έγγραφα"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
              tab === k ? "bg-soft-white text-deep-space" : "bg-white/5 text-muted-blue hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
          <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
        </div>
      ) : (
        <>
          {tab === "upcoming" && (
            <div className="space-y-2.5">
              {(data?.no_country ?? 0) > 0 && (
                <button onClick={() => setTab("people")} className="block w-full rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-left text-sm text-soft-white hover:bg-amber-400/15">
                  ⚠️ {data.no_country} πελάτες χωρίς χώρα, δεν θα πάρουν εθνικές γιορτές. Πάτα εδώ και συμπλήρωσέ τους.
                </button>
              )}

              {timeline.map((ev) => {
                const d = new Date(ev.date + "T00:00:00");
                const thisYear = d.getFullYear() === new Date().getFullYear();
                const dateBlock = (
                  <div className="w-16 shrink-0 text-center">
                    <p className="text-2xl font-bold leading-none text-soft-white">{d.getDate()}</p>
                    <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-blue">
                      {d.toLocaleDateString("el-GR", { month: "short" }).replace(".", "")}
                    </p>
                    {!thisYear && <p className="text-[10px] text-muted-blue/70">{d.getFullYear()}</p>}
                  </div>
                );

                if (ev.type === "holiday") {
                  const h = ev.h;
                  const done = !!data?.sent?.[`all:${h.kind}:${h.date.slice(0, 4)}`];
                  const open = (new Date(h.date) - new Date()) / 86400000 <= 3.5;
                  const namesOpen = openDraft === `names:${h.kind}:${h.date}`;
                  return (
                    <div key={"h" + h.kind + h.date} className="rounded-2xl border border-white/10 bg-deep-space/60 p-4">
                      <div className="flex items-center gap-4">
                        {dateBlock}
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold text-soft-white">{h.label}</p>
                          <button onClick={() => setOpenDraft(namesOpen ? null : `names:${h.kind}:${h.date}`)} className="mt-0.5 text-sm text-muted-blue underline decoration-white/20 underline-offset-2 hover:text-soft-white">
                            {h.recipients} άτομα {namesOpen ? "▴" : "▾"}
                          </button>
                        </div>
                        {done ? (
                          <Chip tone="good">Εστάλησαν</Chip>
                        ) : !open ? (
                          <Chip tone="neutral">Ανοίγει 3 μέρες πριν</Chip>
                        ) : (
                          <button onClick={() => approveBatch(h)} disabled={busyKey === `${h.kind}:${h.date}`}
                            className="rounded-full px-5 py-2.5 text-sm font-bold text-deep-space disabled:opacity-50" style={{ background: GOLD }}>
                            {busyKey === `${h.kind}:${h.date}` ? "Στέλνονται…" : "Έγκριση και αποστολή"}
                          </button>
                        )}
                      </div>
                      {namesOpen && (
                        <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-relaxed text-muted-blue">
                          {(h.names ?? h.sample ?? []).join(" · ")}
                        </p>
                      )}
                    </div>
                  );
                }

                if (ev.type === "departure") {
                  const dep = ev.dep;
                  return (
                    <div key={"d" + dep.person.key + dep.date} className="rounded-2xl border border-white/10 bg-deep-space/40 p-4">
                      <div className="flex items-center gap-4">
                        {dateBlock}
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold text-soft-white">⛵ {dep.person.name} σαλπάρει</p>
                          <p className="mt-0.5 truncate text-sm text-muted-blue">
                            {dep.to && dep.to > dep.date ? `έως ${fmtDay(dep.to)}` : ""}
                            {dep.area ? `${dep.to && dep.to > dep.date ? " · " : ""}${String(dep.area).split(/[.,·]/)[0].trim().slice(0, 48)}` : ""}
                          </p>
                        </div>
                        <Chip tone="neutral">Ναύλος</Chip>
                      </div>
                    </div>
                  );
                }

                const o = ev.o;
                return (
                  <div key={o.key} className="rounded-2xl border border-white/10 bg-deep-space/60 p-4">
                    <div className="flex flex-wrap items-center gap-4">
                      {dateBlock}
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold text-soft-white">
                          {o.person.name}
                          {o.person.vip && <span className="ml-2 text-xs" style={{ color: GOLD }}>VIP</span>}
                        </p>
                        <p className="mt-0.5 text-sm text-muted-blue">
                          {KIND_GR[o.kind] ?? o.label}
                          {o.vessel ? ` · ${o.vessel}` : o.person.vessel ? ` · ${o.person.vessel}` : ""}
                        </p>
                      </div>
                      {o.done ? (
                        <Chip tone="good">Το έστειλες</Chip>
                      ) : (
                        <>
                          <button onClick={() => setOpenDraft(openDraft === o.key ? null : o.key)}
                            className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-soft-white hover:bg-white/15">
                            {openDraft === o.key ? "Κλείσε" : "Δες το draft"}
                          </button>
                          <button onClick={() => markSent(o)} disabled={busyKey === o.key}
                            className="rounded-full px-4 py-2 text-sm font-bold text-deep-space disabled:opacity-50" style={{ background: GOLD }}>
                            Το έστειλα
                          </button>
                        </>
                      )}
                    </div>
                    {openDraft === o.key && (
                      <div className="mt-4 rounded-xl bg-white/5 p-4">
                        <p className="text-xs text-muted-blue">Θέμα: <span className="font-semibold text-soft-white">{o.draft.subject}</span></p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-soft-white/90">{o.draft.body}</p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`${o.draft.subject}\n\n${o.draft.body}`);
                            say("Αντιγράφηκε, επικόλλησέ το στο mail σου");
                          }}
                          className="mt-3 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-soft-white hover:bg-white/15">
                          Αντιγραφή draft
                        </button>
                        {o.person.email && (
                          <a href={`mailto:${o.person.email}?subject=${encodeURIComponent(o.draft.subject)}&body=${encodeURIComponent(o.draft.body)}`}
                            className="ml-2 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-soft-white hover:bg-white/15">
                            Άνοιξε στο mail
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {timeline.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-deep-space/60 p-8 text-center">
                  <p className="text-base text-soft-white">Το ημερολόγιο είναι άδειο.</p>
                  <p className="mt-1 text-sm text-muted-blue">Πρόσθεσε γενέθλια στους Πελάτες ή ανέβασε έγγραφα.</p>
                </div>
              )}
            </div>
          )}

          {tab === "people" && (
            <div>
              <div className="mb-4 flex items-center gap-3">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Αναζήτηση πελάτη…"
                  className="flex-1 rounded-2xl border border-white/10 bg-deep-space/60 px-5 py-3 text-sm text-soft-white placeholder:text-muted-blue/60 focus:outline-none focus:ring-2 focus:ring-[#DAA110]/40"
                />
                <button
                  onClick={async () => {
                    say("Σαρώνω τις σημειώσεις του Helm…");
                    const d = await act({ action: "scan_notes" });
                    setSuggestions(d.suggestions ?? []);
                    say(d.suggestions?.length ? `${d.suggestions.length} πιθανές ημερομηνίες βρέθηκαν` : "Δεν βρέθηκαν ημερομηνίες στις σημειώσεις");
                  }}
                  className="whitespace-nowrap rounded-full bg-white/10 px-5 py-3 text-sm font-semibold text-soft-white hover:bg-white/15"
                >
                  Σάρωση σημειώσεων
                </button>
              </div>

              {suggestions.length > 0 && (
                <div className="mb-4 space-y-2">
                  {suggestions.map((sg, i) => (
                    <div key={i} className="rounded-2xl border border-[#DAA110]/30 bg-[#DAA110]/5 p-4">
                      <p className="text-sm text-soft-white">
                        <strong>{sg.name}</strong> · {KIND_GR[sg.kind] ?? sg.label} · {sg.date}
                      </p>
                      <p className="mt-1 text-xs italic text-muted-blue">«{sg.evidence}»</p>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={async () => {
                            if (sg.kind === "birthday" && sg.contact_id && /^\d{4}-/.test(sg.date)) {
                              await act({ action: "save_person", contact_id: sg.contact_id, fields: { birthday: sg.date } });
                            } else {
                              await act({ action: "add_date", person_key: sg.person_key, kind: sg.kind, date: sg.date, label: sg.label, note: sg.evidence });
                            }
                            setSuggestions(suggestions.filter((_, j) => j !== i));
                            say(`Αποθηκεύτηκε: ${sg.name}`);
                            load();
                          }}
                          className="rounded-full px-4 py-1.5 text-xs font-bold text-deep-space"
                          style={{ background: GOLD }}
                        >
                          Σωστό, κράτα το
                        </button>
                        <button
                          onClick={() => setSuggestions(suggestions.filter((_, j) => j !== i))}
                          className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-soft-white"
                        >
                          Άστο
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Ζώνη Α: με ημερομηνίες. Ζώνη Β: μόνο email (γιορτές). */}
              {(() => {
                const withDates = people.filter((p) => p.birthday || p.anniversary || p.charter_date);
                const emailOnly = people.filter((p) => !p.birthday && !p.anniversary && !p.charter_date);
                return (
                  <>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[3px]" style={{ color: GOLD }}>
                      Με ημερομηνίες · {withDates.length}
                    </p>
                    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {withDates.map((p) => (
                        <ClientCard key={p.key} p={p} onSave={act} onSaved={load} say={say} full />
                      ))}
                      {withDates.length === 0 && (
                        <p className="text-sm text-muted-blue">Κανείς ακόμα. Ανέβασε έγγραφα ή συμπλήρωσε από τις κάρτες κάτω.</p>
                      )}
                    </div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[3px] text-muted-blue">
                      Μόνο email, για τις γιορτές · {emailOnly.length}
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {emailOnly.slice(0, 60).map((p) => (
                        <ClientCard key={p.key} p={p} onSave={act} onSaved={load} say={say} />
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {tab === "documents" && (
            <div className="space-y-4">
              <div className="rounded-2xl border-2 border-dashed border-white/15 bg-deep-space/40 p-8 text-center">
                <p className="text-base font-semibold text-soft-white">Ανέβασε διαβατήριο ή ταυτότητα</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-blue">
                  Διαβάζω μόνο όνομα, ημερομηνία γέννησης και εθνικότητα, μου τα επιβεβαιώνεις, και
                  προαιρετικά το αρχείο φυλάσσεται στο ιδιωτικό κουτί. Ο αριθμός του διαβατηρίου δεν
                  αποθηκεύεται πουθενά.
                </p>
                <label className="mt-4 inline-block cursor-pointer rounded-full px-6 py-3 text-sm font-bold text-deep-space" style={{ background: GOLD }}>
                  {reading ? "Διαβάζω…" : "Διάλεξε αρχείο"}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    disabled={reading}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) readPassport(f); }}
                  />
                </label>
              </div>

              {extracted && (
                <div className="rounded-2xl border border-white/10 bg-deep-space/60 p-6">
                  <p className="text-sm font-bold uppercase tracking-wider" style={{ color: GOLD }}>
                    Επιβεβαίωσε και αποθήκευσε
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setPpMode("new")}
                      className={`rounded-full px-4 py-2 text-xs font-bold ${ppMode === "new" ? "text-deep-space" : "bg-white/10 text-soft-white"}`}
                      style={ppMode === "new" ? { background: GOLD } : {}}
                    >
                      Νέος πελάτης
                    </button>
                    <button
                      onClick={() => setPpMode("existing")}
                      className={`rounded-full px-4 py-2 text-xs font-bold ${ppMode === "existing" ? "text-deep-space" : "bg-white/10 text-soft-white"}`}
                      style={ppMode === "existing" ? { background: GOLD } : {}}
                    >
                      Υπάρχων πελάτης
                    </button>
                  </div>
                  {ppMode === "new" ? (
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="text-xs text-muted-blue">Όνομα
                        <input value={ppForm.name} onChange={(e) => setPpForm({ ...ppForm, name: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-deep-space px-3 py-2 text-sm text-soft-white" />
                      </label>
                      <label className="text-xs text-muted-blue">Γέννηση
                        <input type="date" value={ppForm.date_of_birth} onChange={(e) => setPpForm({ ...ppForm, date_of_birth: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-deep-space px-3 py-2 text-sm text-soft-white" />
                      </label>
                      <label className="text-xs text-muted-blue">Εθνικότητα
                        <input value={ppForm.nationality} onChange={(e) => setPpForm({ ...ppForm, nationality: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-deep-space px-3 py-2 text-sm text-soft-white" />
                      </label>
                      <label className="text-xs text-muted-blue">Email (για τις ευχές, προαιρετικό)
                        <input value={ppForm.email} onChange={(e) => setPpForm({ ...ppForm, email: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-deep-space px-3 py-2 text-sm text-soft-white" />
                      </label>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <label className="text-xs text-muted-blue">Σε ποιον;</label>
                      <select
                        value={targetKey}
                        onChange={(e) => setTargetKey(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-deep-space px-4 py-2.5 text-sm text-soft-white"
                      >
                        <option value="">Διάλεξε…</option>
                        {(data?.people ?? []).map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.name} {p.email ? `(${p.email})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <label className="mt-3 flex items-center gap-2 text-sm text-muted-blue">
                    <input type="checkbox" checked={keepFile} onChange={(e) => setKeepFile(e.target.checked)} />
                    Φύλαξε και το αρχείο στο ιδιωτικό κουτί (για τα χαρτιά του ναύλου)
                  </label>
                  <button
                    onClick={confirmPassport}
                    disabled={saving}
                    className="mt-4 rounded-full px-6 py-2.5 text-sm font-bold text-deep-space disabled:opacity-60"
                    style={{ background: GOLD }}
                  >
                    {saving ? "Αποθηκεύεται…" : "Αποθήκευση"}
                  </button>
                </div>
              )}
              <div className="rounded-2xl border-2 border-dashed border-white/15 bg-deep-space/40 p-8 text-center">
                <p className="text-base font-semibold text-soft-white">Ανέβασε συμβόλαιο MYBA</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-blue">
                  Διαβάζω μόνο το όνομα του ναυλωτή, το σκάφος και τις ημερομηνίες, τον βρίσκω στους
                  Πελάτες και ενημερώνω την καρτέλα του. Τίποτα άλλο από το έγγραφο δεν αποθηκεύεται.
                </p>
                <label className="mt-4 inline-block cursor-pointer rounded-full bg-white/10 px-6 py-3 text-sm font-bold text-soft-white hover:bg-white/15">
                  {ctReading ? "Διαβάζω…" : "Διάλεξε συμβόλαιο"}
                  <input type="file" accept="image/*,.pdf" className="hidden" disabled={ctReading}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) readContract(f); }} />
                </label>
              </div>

              {ctFields && (
                <div className="rounded-2xl border border-white/10 bg-deep-space/60 p-6">
                  <p className="text-sm font-bold uppercase tracking-wider" style={{ color: GOLD }}>Συμβόλαιο</p>
                  <div className="mt-3 space-y-1.5 text-sm text-soft-white">
                    <p>Ναυλωτής: <strong>{ctFields.charterer_name ?? "δεν διαβάστηκε"}</strong></p>
                    <p>Σκάφος: <strong>{ctFields.vessel ?? "δεν διαβάστηκε"}</strong></p>
                    <p>Ναύλος: <strong>{ctFields.date_from ?? "?"} έως {ctFields.date_to ?? "?"}</strong></p>
                  </div>
                  <div className="mt-4">
                    <label className="text-xs text-muted-blue">Ποιανού πελάτη είναι;</label>
                    <select value={ctTarget} onChange={(e) => setCtTarget(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-deep-space px-4 py-2.5 text-sm text-soft-white">
                      <option value="">Διάλεξε…</option>
                      {(data?.people ?? []).map((p) => (
                        <option key={p.key} value={p.key}>{p.name} {p.email ? `(${p.email})` : ""}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={confirmContract} disabled={saving} className="mt-4 rounded-full px-6 py-2.5 text-sm font-bold text-deep-space disabled:opacity-60" style={{ background: GOLD }}>
                    {saving ? "Αποθηκεύεται…" : "Ενημέρωσε την καρτέλα"}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ClientCard({ p, onSave, onSaved, say, full = false }) {
  const [editing, setEditing] = useState(false);
  const [bday, setBday] = useState(p.birthday ? String(p.birthday).slice(0, 10) : "");
  const [country, setCountry] = useState(p.country ?? "");
  const [anniv, setAnniv] = useState(p.anniversary ? String(p.anniversary).slice(0, 10) : "");

  async function save() {
    await onSave({
      action: "apply_document",
      person_key: p.key,
      contact_id: p.contact_id,
      fields: { birthday: bday || null, country: country || null, anniversary: anniv || null },
    });
    setEditing(false);
    say(`Αποθηκεύτηκε: ${p.name}`);
    onSaved();
  }

  const md = (d, withYear = false) => {
    if (!d) return null;
    const x = new Date(String(d).slice(0, 10) + "T00:00:00");
    return x.toLocaleDateString("el-GR", withYear ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" });
  };
  const today = new Date().toISOString().slice(0, 10);
  const futureTrip = p.travel_from && String(p.travel_from) > today;

  const status =
    p.won ? { label: "ΠΕΛΑΤΗΣ", style: { background: GOLD, color: "#0D1B2A" } }
    : p.helm_status === "lost" ? { label: "LOST", style: { background: "rgba(255,255,255,0.08)", color: "#8593A0" } }
    : p.helm_status === "prospect" ? { label: "ΝΕΟΣ", style: { background: "rgba(99,183,146,0.2)", color: "#63B792" } }
    : { label: "ΣΕ ΣΥΖΗΤΗΣΗ", style: { background: "rgba(255,255,255,0.12)", color: "#E4EAF0" } };

  const Row = ({ label, children }) => (
    <div className="flex items-baseline gap-2 text-[12.5px] leading-relaxed">
      <span className="w-[86px] shrink-0 text-muted-blue/70">{label}</span>
      <span className="text-soft-white">{children}</span>
    </div>
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-deep-space/60 p-4 transition-colors hover:border-white/20">
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[15px] font-semibold text-soft-white">
          {flagOf(p.country)} {p.name}
        </p>
        <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider" style={status.style}>
          {status.label}
        </span>
      </div>

      <div className="mt-3 space-y-1">
        {p.email && <Row label="Email">{p.email}</Row>}
        {p.country && <Row label="Εθνικότητα">{p.country}</Row>}
        {p.travel_from && (
          <Row label={futureTrip ? "Ταξιδεύει" : "Ταξίδεψε"}>
            {md(p.travel_from, true)}
            {p.travel_to && String(p.travel_to) > String(p.travel_from) ? ` έως ${md(p.travel_to, true)}` : ""}
            {p.area ? ` · ${String(p.area).split(/[.,·]/)[0].trim().slice(0, 42)}` : ""}
          </Row>
        )}
        {p.charter_vessel && (
          <Row label="Σκάφος">
            <span className="font-semibold" style={{ color: GOLD }}>⛵ {p.charter_vessel}</span>
          </Row>
        )}
        {(p.discussed ?? []).filter((y) => y !== p.charter_vessel).length > 0 && (
          <Row label="Συζητήθηκαν">{(p.discussed ?? []).filter((y) => y !== p.charter_vessel).slice(0, 3).join(", ")}</Row>
        )}
        {p.birthday && <Row label="Γενέθλια">🎂 {md(p.birthday)}</Row>}
        {p.anniversary && <Row label="Επέτειος">💍 {md(p.anniversary)}</Row>}
      </div>

      <div className="mt-3 flex gap-2">
        <button onClick={() => setEditing(!editing)} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-soft-white hover:bg-white/15">
          {editing ? "Κλείσε" : "Συμπλήρωσε"}
        </button>
        {p.email && (
          <a href={`mailto:${p.email}`} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-soft-white hover:bg-white/15">
            Email
          </a>
        )}
      </div>
      {editing && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted-blue">Γενέθλια
            <input type="date" value={bday} onChange={(e) => setBday(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-deep-space px-2 py-1.5 text-xs text-soft-white" />
          </label>
          <label className="text-xs text-muted-blue">Εθνικότητα
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United States" className="mt-1 w-full rounded-lg border border-white/10 bg-deep-space px-2 py-1.5 text-xs text-soft-white" />
          </label>
          <label className="text-xs text-muted-blue">Επέτειος
            <input type="date" value={anniv} onChange={(e) => setAnniv(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-deep-space px-2 py-1.5 text-xs text-soft-white" />
          </label>
          <button onClick={save} className="self-end rounded-full px-4 py-2 text-xs font-bold text-deep-space" style={{ background: GOLD }}>
            Αποθήκευση
          </button>
        </div>
      )}
    </div>
  );
}

function PersonRow({ p, onSave, onSaved, say }) {
  const [editing, setEditing] = useState(false);
  const [bday, setBday] = useState(p.birthday ? String(p.birthday).slice(0, 10) : "");
  const [country, setCountry] = useState(p.country ?? "");
  const [anniv, setAnniv] = useState(p.anniversary ? String(p.anniversary).slice(0, 10) : "");

  const completeness = [p.birthday, p.country].filter(Boolean).length;

  async function save() {
    if (p.contact_id) {
      await onSave({
        action: "save_person",
        contact_id: p.contact_id,
        fields: { birthday: bday || null, country: country || null, anniversary_date: anniv || null },
      });
    } else {
      if (bday) await onSave({ action: "add_date", person_key: p.key, kind: "birthday", date: bday, label: "Birthday" });
      if (anniv) await onSave({ action: "add_date", person_key: p.key, kind: "anniversary", date: anniv, label: "Anniversary" });
    }
    setEditing(false);
    say(`Αποθηκεύτηκε: ${p.name}`);
    onSaved();
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-deep-space/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-soft-white">
            {p.name}
            {p.won && <span className="ml-2 text-[10px] uppercase tracking-wider" style={{ color: GOLD }}>πελάτης</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-blue">
            {p.email ?? "χωρίς email"} · {p.country ?? "χωρίς χώρα"} ·{" "}
            {p.birthday ? `γενέθλια ${String(p.birthday).slice(5, 10)}` : "χωρίς γενέθλια"}
            {p.source === "cabin" ? " · από Cabin" : p.source === "helm+cabin" ? " · Helm + Cabin" : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {[0, 1].map((i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${i < completeness ? "bg-emerald" : "bg-white/15"}`} />
          ))}
        </div>
        <button
          onClick={() => setEditing(!editing)}
          className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-soft-white hover:bg-white/15"
        >
          {editing ? "Κλείσε" : "Συμπλήρωσε"}
        </button>
      </div>
      {editing && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
          <label className="text-xs text-muted-blue">
            Γενέθλια
            <input type="date" value={bday} onChange={(e) => setBday(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-deep-space px-2 py-1.5 text-xs text-soft-white" />
          </label>
          <label className="text-xs text-muted-blue">
            Χώρα
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United States" className="mt-1 w-full rounded-lg border border-white/10 bg-deep-space px-2 py-1.5 text-xs text-soft-white" />
          </label>
          <label className="text-xs text-muted-blue">
            Επέτειος
            <input type="date" value={anniv} onChange={(e) => setAnniv(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-deep-space px-2 py-1.5 text-xs text-soft-white" />
          </label>
          <button onClick={save} className="self-end rounded-full px-4 py-2 text-xs font-bold text-deep-space" style={{ background: GOLD }}>
            Αποθήκευση
          </button>
        </div>
      )}
    </div>
  );
}
