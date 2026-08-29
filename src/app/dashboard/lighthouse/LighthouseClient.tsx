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
  const [suggestions, setSuggestions] = useState([]);

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
    // Best-guess match by surname.
    const sur = (d.fields.full_name || "").trim().split(/\s+/).pop()?.toLowerCase();
    const hit = (data?.people ?? []).find((p) => sur && p.name.toLowerCase().includes(sur));
    setTargetKey(hit?.key ?? "");
  }

  async function confirmPassport() {
    if (!extracted) return;
    const person = (data?.people ?? []).find((p) => p.key === targetKey);
    if (person?.contact_id) {
      await act({
        action: "save_person",
        contact_id: person.contact_id,
        fields: { birthday: extracted.date_of_birth, country: person.country || extracted.nationality },
      });
    } else if (person) {
      await act({
        action: "add_date",
        person_key: person.key,
        kind: "birthday",
        date: extracted.date_of_birth,
        label: "Birthday (από διαβατήριο)",
      });
    } else {
      return say("Διάλεξε σε ποιον ανήκει το έγγραφο");
    }
    if (keepFile && passportFile) {
      const fd = new FormData();
      fd.append("file", passportFile);
      fd.append("person", person.name);
      await fetch("/api/lighthouse/upload", { method: "POST", body: fd });
    }
    say(`Αποθηκεύτηκε: ${extracted.full_name}`);
    setExtracted(null);
    setPassportFile(null);
    load();
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
          ["people", "Άνθρωποι"],
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
            <div className="space-y-3">
              {(data?.holidays_year ?? data?.holidays ?? []).map((h) => {
                const done = !!data?.sent?.[`all:${h.kind}:${h.date.slice(0, 4)}`];
                return (
                  <div key={h.kind + h.date} className="rounded-2xl border border-white/10 bg-deep-space/60 p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1">
                        <p className="text-base font-semibold text-soft-white">{h.label}</p>
                        <p className="mt-0.5 text-sm text-muted-blue">
                          {fmtDay(h.date)} · {h.recipients} παραλήπτες · {h.sample.join(", ")}
                          {h.recipients > 5 ? "…" : ""}
                        </p>
                      </div>
                      {done ? (
                        <Chip tone="good">Εστάλησαν</Chip>
                      ) : (new Date(h.date) - new Date()) / 86400000 > 3.5 ? (
                        <Chip tone="neutral">Ανοίγει 3 μέρες πριν</Chip>
                      ) : (
                        <button
                          onClick={() => approveBatch(h)}
                          disabled={busyKey === `${h.kind}:${h.date}`}
                          className="rounded-full px-5 py-2.5 text-sm font-bold text-deep-space disabled:opacity-50"
                          style={{ background: GOLD }}
                        >
                          {busyKey === `${h.kind}:${h.date}` ? "Στέλνονται…" : "Έγκριση και αποστολή"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {personal.length === 0 && (data?.holidays ?? []).length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-deep-space/60 p-8 text-center">
                  <p className="text-base text-soft-white">Ήσυχος μήνας.</p>
                  <p className="mt-1 text-sm text-muted-blue">
                    Καμία γιορτή τις επόμενες 30 μέρες. Πρόσθεσε γενέθλια στους Ανθρώπους ή ανέβασε
                    έγγραφα για να γεμίσει ο φάρος.
                  </p>
                </div>
              )}

              {personal.map((o) => (
                <div key={o.key} className="rounded-2xl border border-white/10 bg-deep-space/60 p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1">
                      <p className="text-base font-semibold text-soft-white">
                        {o.person.name}
                        {o.person.vip && <span className="ml-2 text-xs" style={{ color: GOLD }}>VIP</span>}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-blue">
                        {KIND_GR[o.kind] ?? o.label} · {fmtDay(o.date)}
                        {o.vessel ? ` · ${o.vessel}` : o.person.vessel ? ` · ${o.person.vessel}` : ""}
                      </p>
                    </div>
                    {o.done ? (
                      <Chip tone="good">Το έστειλες</Chip>
                    ) : (
                      <>
                        <button
                          onClick={() => setOpenDraft(openDraft === o.key ? null : o.key)}
                          className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-soft-white hover:bg-white/15"
                        >
                          {openDraft === o.key ? "Κλείσε" : "Δες το draft"}
                        </button>
                        <button
                          onClick={() => markSent(o)}
                          disabled={busyKey === o.key}
                          className="rounded-full px-4 py-2 text-sm font-bold text-deep-space disabled:opacity-50"
                          style={{ background: GOLD }}
                        >
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
                        className="mt-3 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-soft-white hover:bg-white/15"
                      >
                        Αντιγραφή draft
                      </button>
                      {o.person.email && (
                        <a
                          href={`mailto:${o.person.email}?subject=${encodeURIComponent(o.draft.subject)}&body=${encodeURIComponent(o.draft.body)}`}
                          className="ml-2 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-soft-white hover:bg-white/15"
                        >
                          Άνοιξε στο mail
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "people" && (
            <div>
              <div className="mb-4 flex items-center gap-3">
                <button
                  onClick={async () => {
                    say("Σαρώνω τις σημειώσεις του Helm…");
                    const d = await act({ action: "scan_notes" });
                    setSuggestions(d.suggestions ?? []);
                    say(d.suggestions?.length ? `${d.suggestions.length} πιθανές ημερομηνίες βρέθηκαν` : "Δεν βρέθηκαν ημερομηνίες στις σημειώσεις");
                  }}
                  className="rounded-full bg-white/10 px-5 py-2 text-sm font-semibold text-soft-white hover:bg-white/15"
                >
                  Σάρωσε τις σημειώσεις του Helm
                </button>
              </div>
              {(() => {
                const withB = (data?.people ?? [])
                  .filter((p) => p.birthday)
                  .map((p) => {
                    const md = String(p.birthday).slice(5, 10);
                    const now = new Date();
                    const y = now.getFullYear();
                    let next = new Date(`${y}-${md}T00:00:00`);
                    if (next < now) next = new Date(`${y + 1}-${md}T00:00:00`);
                    return { ...p, md, next };
                  })
                  .sort((a, b) => a.next - b.next);
                if (!withB.length) return null;
                return (
                  <div className="mb-5">
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[3px] text-muted-blue">
                      Με γενέθλια · {withB.length}
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {withB.map((p) => (
                        <div key={p.key} className="rounded-xl border border-white/10 bg-deep-space/60 px-3 py-2.5">
                          <p className="truncate text-sm font-semibold text-soft-white">{p.name}</p>
                          <p className="text-xs" style={{ color: GOLD }}>
                            {p.next.toLocaleDateString("el-GR", { day: "numeric", month: "long" })}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Αναζήτηση ονόματος ή email…"
                className="mb-4 w-full rounded-2xl border border-white/10 bg-deep-space/60 px-5 py-3 text-sm text-soft-white placeholder:text-muted-blue/60 focus:outline-none focus:ring-2 focus:ring-[#DAA110]/40"
              />
              <div className="space-y-2">
                {people.slice(0, 80).map((p) => (
                  <PersonRow key={p.key} p={p} onSave={act} onSaved={load} say={say} />
                ))}
              </div>
              {people.length > 80 && (
                <p className="mt-3 text-center text-xs text-muted-blue">
                  {people.length - 80} ακόμα, ψάξε με το όνομα για να τους βρεις
                </p>
              )}
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
                    onChange={(e) => e.target.files?.[0] && readPassport(e.target.files[0])}
                  />
                </label>
              </div>

              {extracted && (
                <div className="rounded-2xl border border-white/10 bg-deep-space/60 p-6">
                  <p className="text-sm font-bold uppercase tracking-wider" style={{ color: GOLD }}>
                    Επιβεβαίωσε
                  </p>
                  <div className="mt-3 space-y-2 text-sm text-soft-white">
                    <p>Όνομα: <strong>{extracted.full_name ?? "δεν διαβάστηκε"}</strong></p>
                    <p>Γέννηση: <strong>{extracted.date_of_birth ?? "δεν διαβάστηκε"}</strong></p>
                    <p>Εθνικότητα: <strong>{extracted.nationality ?? "δεν διαβάστηκε"}</strong></p>
                  </div>
                  <div className="mt-4">
                    <label className="text-xs text-muted-blue">Σε ποιον ανήκει;</label>
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
                  <label className="mt-3 flex items-center gap-2 text-sm text-muted-blue">
                    <input type="checkbox" checked={keepFile} onChange={(e) => setKeepFile(e.target.checked)} />
                    Φύλαξε και το αρχείο στο ιδιωτικό κουτί (για τα χαρτιά του ναύλου)
                  </label>
                  <button
                    onClick={confirmPassport}
                    className="mt-4 rounded-full px-6 py-2.5 text-sm font-bold text-deep-space"
                    style={{ background: GOLD }}
                  >
                    Αποθήκευση
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
