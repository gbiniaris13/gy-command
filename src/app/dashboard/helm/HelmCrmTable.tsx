"use client";

import { followUpLabels } from "@/lib/helm/pipeline";

// The Helm — the CRM table (2026-07-17, George's spec: "μπαίνω και έχω πλήρη
// εικόνα και δεν μπερδεύομαι"). One clean row per request, and every fact he
// asked to see AT A GLANCE is its own column: when it came in, who (with the
// country flag from their phone and a Direct/Advisor tag), how many guests,
// the budget, where they go, the charter dates with a LOUD year badge (2027
// must jump out), the stage, and the next move — including whether the client
// has already opened the proposal (the strongest "call now" signal we have).
// The whole row is clickable; a single search box matches name, email, area
// and the GY ref; chips filter by year, stage and day/week.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export type FuStepRow = { due: string; done_at: string | null; how: string | null; kind?: "nudge" | "reopen" | "bye" };

export type CrmRow = {
  id: string;
  ref: string;
  name: string;
  email: string;
  whatsapp: string;
  flag: string;
  country: string;
  party: string;
  budget: string;
  area: string;
  datesFrom: string | null;
  datesTo: string | null;
  year: number | null;
  nights: number | null;
  isDay: boolean;
  status: string;
  due: boolean;
  followUpAt: string | null;
  isAgent: boolean;
  createdAt: string;
  salonViews: number;
  salonLastAt: string | null;
  interest: string | null;
  waitingDays: number | null;
  onNewsletter: boolean;
  // 2026-07-24 pipeline upgrade
  sentAt: string | null; // when the proposal email left for the client
  fu: FuStepRow[] | null; // the 3-step follow-up plan (null = not laid yet)
  notes: string; // George's own hand-written state of play
  yachts: string[]; // "M/Y ALTEA", "S/CAT LUCKY CLOVER", ...
  wantedNights: number | null; // what the client wants inside a flexible window
  flexWindow: boolean; // dates span 10+ nights = a window, not the charter length
};

const STATUS_OPTIONS = ["new", "drafted", "sent", "in_conversation", "negotiating", "won", "lost"];

const STAGE_LABEL: Record<string, string> = {
  new: "New", drafted: "Drafted", sent: "Sent", in_conversation: "In conversation",
  negotiating: "Negotiating", won: "Won", lost: "Lost",
};
const STAGE_COLOR: Record<string, string> = {
  new: "#9CA3AF", drafted: "#C9A84C", sent: "#60A5FA", in_conversation: "#34D399",
  negotiating: "#F59E0B", won: "#0D1B2A", lost: "#94a3b8",
};

// Europe/Athens everywhere: George thinks in Athens time (the GY ref codes
// are Athens too), and a fixed zone keeps the server-rendered HTML identical
// to the client hydration — no timezone flicker. Date-only strings (charter
// dates) still show the same calendar day.
function fmt(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Athens" });
}
// Received date carries the year and stays readable (George: the old one was
// "πολύ αχνή"). "14 Jul 26".
function fmtReceived(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Europe/Athens" });
}

// Sent moment with the time (George 2026-07-24: "θέλω να βλέπω την
// ημερομηνία ΚΑΙ ώρα που έστειλα την προσφορά"). "22 Jul 26 · 11:30".
function fmtSent(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Europe/Athens" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });
  return `${date} · ${time}`;
}

// ── Follow-ups cell: the WHOLE suggested plan, however long it is (2026-08-04
// it became 1 to 6 steps, scaled to how far away the charter is). Each date is
// editable in place and each step tickable "I did it" from WhatsApp, a call,
// anywhere. A summary line on top answers the only question that matters at a
// glance: is this client due today. follow_up_at stays mirrored server-side.
function FollowUpsCell({ id, fu, status }: { id: string; fu: FuStepRow[] | null; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const canPlan = ["sent", "in_conversation", "negotiating"].includes(status);

  async function post(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const res = await fetch(`/api/helm/${id}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      /* the refresh simply won't show a change */
    } finally {
      setBusy(null);
    }
  }

  if (!fu || fu.length === 0) {
    if (!canPlan) return <span style={{ color: "#cbd5e1" }}>-</span>;
    return (
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => post({ action: "plan-init" }, "init")}
        style={{
          fontSize: 10.5, padding: "4px 10px", cursor: "pointer", borderRadius: 3,
          border: "1px solid rgba(201,168,76,0.5)", background: "rgba(201,168,76,0.10)",
          color: "#A8873B", fontWeight: 600, letterSpacing: 0.5,
        }}
      >
        {busy ? "..." : "Suggest dates"}
      </button>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const plannedFor = fu.length;
  const doneCount = fu.filter((s) => s.done_at).length;
  const pending = fu.filter((s) => !s.done_at);
  const overdue = pending.filter((s) => s.due < today).length;
  const dueToday = pending.some((s) => s.due === today);
  const nextDue = pending[0]?.due ?? null;
  const summaryColour = overdue > 0 ? "#b91c1c" : dueToday ? "#b45309" : doneCount === plannedFor ? "#0d6e5a" : "#6b7280";
  const summaryText =
    doneCount === plannedFor ? "all done"
    : overdue > 0 ? `${overdue} overdue`
    : dueToday ? "due TODAY"
    : nextDue ? `next ${fmt(nextDue)}` : "";
  // Labels come off the plan itself now: it can be 1 to 6 steps long and the
  // goodbye is not always the third one (2026-08-04).
  const marks = followUpLabels(fu);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontSize: 9.5, letterSpacing: 0.4, color: summaryColour, fontWeight: 700, marginBottom: 1 }}>
        {doneCount}/{plannedFor} sent · {summaryText}
      </div>
      {fu.map((s, i) => {
        const done = !!s.done_at;
        const isDue = !done && s.due <= today;
        return (
          <div key={i} title={marks[i]?.title} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, width: 24, letterSpacing: 0.5,
              color: done ? "#0d6e5a" : isDue ? "#b45309" : "#9CA3AF",
            }}>
              {done ? "✓" : isDue ? "●" : "○"} {marks[i]?.short}
            </span>
            {done ? (
              <span style={{ fontSize: 11, color: "#0d6e5a" }}>
                done {fmt(s.done_at)}{s.how ? ` · ${s.how}` : ""}
              </span>
            ) : (
              <>
                <input
                  type="date"
                  defaultValue={s.due}
                  disabled={busy !== null}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v && v !== s.due) post({ action: "plan-set", step: i, date: v }, `set${i}`);
                  }}
                  style={{
                    fontSize: 11, border: "1px solid rgba(13,27,42,0.12)", borderRadius: 3,
                    padding: "1px 3px", color: isDue ? "#b45309" : "#374151",
                    fontWeight: isDue ? 700 : 400, width: 108, background: "#fff",
                  }}
                />
                <button
                  type="button"
                  title="Mark this follow-up as done (call, WhatsApp, anywhere)"
                  disabled={busy !== null}
                  onClick={() => post({ action: "plan-done", step: i, how: "pipeline" }, `done${i}`)}
                  style={{
                    fontSize: 11, lineHeight: 1, padding: "3px 6px", cursor: "pointer",
                    border: "1px solid rgba(13,110,90,0.35)", borderRadius: 3,
                    background: "rgba(13,110,90,0.08)", color: "#0d6e5a", fontWeight: 700,
                  }}
                >
                  {busy === `done${i}` ? "…" : "✓"}
                </button>
              </>
            )}
          </div>
        );
      })}
      <button
        type="button"
        disabled={busy !== null}
        title="Rebuild the plan from today using the current cadence. Steps already ticked stay ticked."
        onClick={(e) => { e.stopPropagation(); post({ action: "plan-replan" }, "replan"); }}
        style={{
          alignSelf: "flex-start", marginTop: 2, background: "none", border: "none",
          padding: 0, cursor: "pointer", fontSize: 9.5, letterSpacing: 0.4,
          color: "#9CA3AF", textDecoration: "underline",
        }}
      >
        {busy === "replan" ? "..." : `re-plan (${plannedFor})`}
      </button>
    </div>
  );
}

// ── Notes cell: George's freehand notes, saved in place. ────────────────
function NotesCell({ id, initial }: { id: string; initial: string }) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = v !== saved;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/helm/${id}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "notes-set", notes: v }),
      });
      if (res.ok) setSaved(v);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <textarea
        value={v}
        placeholder="Your notes..."
        onChange={(e) => setV(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={save}
        rows={3}
        style={{
          width: "100%", fontSize: 11.5, lineHeight: 1.4, resize: "vertical",
          border: `1px solid ${dirty ? "rgba(201,168,76,0.6)" : "rgba(13,27,42,0.10)"}`,
          borderRadius: 3, padding: "4px 6px", color: "#374151", background: "#fffdf7",
          fontFamily: "inherit", minHeight: 46,
        }}
      />
      {(dirty || saving) && (
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            alignSelf: "flex-end", fontSize: 10, padding: "2px 10px", cursor: "pointer",
            border: "1px solid rgba(201,168,76,0.5)", borderRadius: 3,
            background: "#C9A84C", color: "#0D1B2A", fontWeight: 700,
          }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      )}
    </div>
  );
}

// ── Wanted-nights inline edit for flexible windows ("a week in August"). ─
function WantedNights({ id, value }: { id: string; value: number | null }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  return (
    <span onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
      wants{" "}
      <input
        type="number"
        min={1}
        max={60}
        defaultValue={value ?? ""}
        placeholder="7"
        disabled={saving}
        onBlur={async (e) => {
          const n = e.target.value;
          if (n === String(value ?? "")) return;
          setSaving(true);
          try {
            await fetch(`/api/helm/${id}/followup`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "wanted-nights", nights: n ? Number(n) : null }),
            });
            router.refresh();
          } finally {
            setSaving(false);
          }
        }}
        style={{
          width: 34, fontSize: 10.5, border: "1px solid rgba(13,27,42,0.15)",
          borderRadius: 3, padding: "0 3px", textAlign: "center",
        }}
      />{" "}
      nights
    </span>
  );
}

// Inline stage change straight from the list (George 2026-07-17: "χωρίς να
// μπαίνω μέσα"). PATCHes /api/helm/:id and refreshes; stops the click from
// also opening the row.
function StatusSelect({ id, value }: { id: string; value: string }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [saving, setSaving] = useState(false);
  async function change(next: string) {
    const prev = v;
    setV(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/helm/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setV(prev); // roll back the visible value if the save failed
    } finally {
      setSaving(false);
    }
  }
  return (
    <select
      value={v}
      disabled={saving}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => change(e.target.value)}
      title="Change stage"
      style={{
        appearance: "auto", border: "none", cursor: "pointer", borderRadius: 3,
        padding: "3px 4px", fontSize: 9.5, letterSpacing: 0.3, textTransform: "uppercase",
        background: STAGE_COLOR[v] || "#9CA3AF", color: "#fff", fontWeight: 600,
        opacity: saving ? 0.6 : 1, maxWidth: "100%", width: "100%",
      }}
    >
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s} style={{ background: "#fff", color: "#0D1B2A" }}>{STAGE_LABEL[s] || s}</option>
      ))}
    </select>
  );
}

export default function HelmCrmTable({ rows }: { rows: CrmRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [year, setYear] = useState<"all" | number>("all");
  const [stage, setStage] = useState<"all" | "active" | string>("active");
  const [kind, setKind] = useState<"all" | "day" | "week">("all");

  const years = useMemo(
    () => Array.from(new Set(rows.map((r) => r.year).filter((y): y is number => !!y))).sort((a, b) => a - b),
    [rows],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && ![r.name, r.email, r.area, r.ref, r.whatsapp, r.country].some((v) => v.toLowerCase().includes(needle))) return false;
      if (year !== "all" && r.year !== year) return false;
      if (stage === "active" && (r.status === "lost" || r.status === "won")) return false;
      if (stage !== "all" && stage !== "active" && r.status !== stage) return false;
      if (kind === "day" && !r.isDay) return false;
      if (kind === "week" && r.isDay) return false;
      return true;
    });
  }, [rows, q, year, stage, kind]);

  const chip = (active: boolean): React.CSSProperties => ({
    padding: "5px 12px", fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
    border: `1px solid ${active ? "#0D1B2A" : "rgba(13,27,42,0.15)"}`,
    background: active ? "#0D1B2A" : "#fff", color: active ? "#F8F5F0" : "#6b7280",
    cursor: "pointer", borderRadius: 999,
  });

  const thisYear = new Date().getFullYear();

  return (
    <>
      {/* controls: one search, three chip groups */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search: name, email, Ref GY…, area"
          style={{ flex: "1 1 260px", maxWidth: 360, padding: "8px 12px", fontSize: 13, border: "1px solid rgba(13,27,42,0.15)", borderRadius: 2 }}
        />
        <button type="button" style={chip(stage === "active")} onClick={() => setStage("active")}>Active</button>
        <button type="button" style={chip(stage === "all")} onClick={() => setStage("all")}>All</button>
        <button type="button" style={chip(stage === "won")} onClick={() => setStage(stage === "won" ? "active" : "won")}>Won</button>
        <span style={{ width: 1, height: 20, background: "rgba(13,27,42,0.12)" }} />
        <button type="button" style={chip(year === "all")} onClick={() => setYear("all")}>All years</button>
        {years.map((y) => (
          <button key={y} type="button" style={{ ...chip(year === y), ...(y > thisYear && year !== y ? { borderColor: "#C9A84C", color: "#A8873B" } : {}) }} onClick={() => setYear(y)}>{y}</button>
        ))}
        <span style={{ width: 1, height: 20, background: "rgba(13,27,42,0.12)" }} />
        <button type="button" style={chip(kind === "week")} onClick={() => setKind(kind === "week" ? "all" : "week")}>Weekly</button>
        <button type="button" style={chip(kind === "day")} onClick={() => setKind(kind === "day" ? "all" : "day")}>Day</button>
      </div>

      <div style={{ background: "#fff", border: "1px solid rgba(13,27,42,0.08)", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 1560, tableLayout: "fixed" }}>
          {/* Fixed widths so every column stays on screen; long free-text
              (guests, route, budget) wraps inside its box instead of shoving
              the later columns off the right edge. 2026-07-24: Sent rides
              inside the Ref cell; Follow-ups, Yachts and Notes are new. */}
          <colgroup>
            <col style={{ width: 134 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 92 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 148 }} />
            <col style={{ width: 128 }} />
            <col style={{ width: 118 }} />
            <col style={{ width: 196 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 164 }} />
          </colgroup>
          <thead>
            <tr style={{ background: "rgba(13,27,42,0.04)", textAlign: "left" }}>
              <th style={th}>Ref · Received · Sent</th>
              <th style={th}>Client</th>
              <th style={thCenter}>Guests</th>
              <th style={th}>Budget</th>
              <th style={th}>Route</th>
              <th style={th}>Charter dates</th>
              <th style={th}>Yachts</th>
              <th style={th}>Status</th>
              <th style={th}>Follow-ups</th>
              <th style={th}>Signals</th>
              <th style={th}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={11} style={{ padding: 32, textAlign: "center", color: "#6b7280", fontStyle: "italic" }}>
                Nothing matches. Clear the search or filters.
              </td></tr>
            )}
            {shown.map((r) => {
              const futureYear = !!r.year && r.year > thisYear;
              return (
              <tr
                key={r.id}
                onClick={() => {
                  // Let George select-and-copy an email or phone from the row
                  // without the click whisking him into the request.
                  if (window.getSelection()?.toString()) return;
                  router.push(`/dashboard/helm/${r.id}`);
                }}
                style={{ borderBottom: "1px solid rgba(13,27,42,0.05)", opacity: r.status === "lost" ? 0.55 : 1, cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,168,76,0.06)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {/* Ref + when it came in + when the proposal LEFT (with time) */}
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <Link
                    href={`/dashboard/helm/${r.id}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ fontFamily: "monospace", fontSize: 12.5, color: "#A8873B", fontWeight: 700, textDecoration: "none" }}
                  >
                    {r.ref}
                  </Link>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    <span style={{ color: "#9CA3AF" }}>Received </span>{fmtReceived(r.createdAt)}
                  </div>
                  {r.sentAt && (
                    <div style={{ fontSize: 11, color: "#0d6e5a", marginTop: 2, fontWeight: 600 }} title="When the proposal email left for the client (Athens time)">
                      <span style={{ color: "#9CA3AF", fontWeight: 400 }}>Sent </span>{fmtSent(r.sentAt)}
                    </div>
                  )}
                </td>

                {/* Client: flag + name, Direct/Advisor tag, contact line */}
                <td style={td}>
                  <strong style={{ fontSize: 14 }}>{r.flag ? `${r.flag} ` : ""}{r.name}</strong>
                  <div style={{ marginTop: 3, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 9, letterSpacing: 1, textTransform: "uppercase", padding: "1px 6px", borderRadius: 3,
                      background: r.isAgent ? "rgba(109,40,217,0.10)" : "rgba(13,110,90,0.10)",
                      color: r.isAgent ? "#6D28D9" : "#0d6e5a",
                      border: `1px solid ${r.isAgent ? "rgba(109,40,217,0.25)" : "rgba(13,110,90,0.25)"}`,
                    }}>{r.isAgent ? "Travel advisor" : "Direct client"}</span>
                    {r.onNewsletter && (
                      <span title="Already on the newsletter list" style={{
                        fontSize: 9, letterSpacing: 1, textTransform: "uppercase", padding: "1px 6px", borderRadius: 3,
                        background: "rgba(201,168,76,0.12)", color: "#A8873B", border: "1px solid rgba(201,168,76,0.35)",
                      }}>✉ Newsletter</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 3, wordBreak: "break-word" }}>
                    {r.email}{r.whatsapp ? ` · ${r.whatsapp}` : ""}
                  </div>
                </td>

                {/* Guests — its own column (wraps if the party text is long) */}
                <td style={tdCenter}>
                  {r.party ? <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{r.party}</span> : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>

                {/* Budget — its own column */}
                <td style={td}>
                  {r.budget ? <span style={{ fontWeight: 600, color: "#0D1B2A", lineHeight: 1.3 }}>{r.budget}</span> : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>

                {/* Route — wraps to a second line, never truncated */}
                <td style={td}>
                  {r.area
                    ? <span style={{ whiteSpace: "normal", lineHeight: 1.35 }}>{r.area}</span>
                    : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>

                {/* Charter dates + LOUD year badge. A 10+ night span is a
                    WINDOW ("a week in August"), not the charter length -
                    show the window and what the client actually wants. */}
                <td style={td}>
                  {r.datesFrom ? (
                    <>
                      <span style={{ whiteSpace: "nowrap" }}>{fmt(r.datesFrom)}{r.datesTo ? ` – ${fmt(r.datesTo)}` : ""}</span>
                      {r.year && (
                        <span style={{
                          marginLeft: 8, display: "inline-block", fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 999,
                          background: futureYear ? "#C9A84C" : "rgba(13,27,42,0.08)",
                          color: futureYear ? "#0D1B2A" : "#6b7280",
                        }}>{r.year}</span>
                      )}
                      <div style={{ fontSize: 10.5, color: "#9CA3AF", marginTop: 2 }}>
                        {r.isDay
                          ? "day charter"
                          : r.flexWindow
                            ? <>flexible window · <WantedNights id={r.id} value={r.wantedNights} /></>
                            : r.nights ? `${r.nights} nights / ${r.nights + 1} days` : ""}
                      </div>
                    </>
                  ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>

                {/* Yachts in the proposal - George's shorthand prefixes */}
                <td style={td}>
                  {r.yachts.length ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {r.yachts.slice(0, 6).map((y, i) => (
                        <span key={i} style={{ fontSize: 11.5, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={y}>{y}</span>
                      ))}
                      {r.yachts.length > 6 && <span style={{ fontSize: 10.5, color: "#9CA3AF" }}>+{r.yachts.length - 6} more</span>}
                    </div>
                  ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>

                {/* Status — editable inline (change stage without opening).
                    The whole cell swallows the click: a near-miss around the
                    dropdown must not navigate away mid-change. */}
                <td style={td} onClick={(e) => e.stopPropagation()}>
                  <StatusSelect id={r.id} value={r.status} />
                </td>

                {/* Follow-ups - the 3-step plan, dates editable, steps tickable */}
                <td style={td} onClick={(e) => e.stopPropagation()}>
                  <FollowUpsCell id={r.id} fu={r.fu} status={r.status} />
                </td>

                {/* Signals — engagement (the buying signal) + waiting/next hints */}
                <td style={td}>
                  {r.interest ? (
                    <div style={{ color: "#A8873B", fontSize: 12, fontWeight: 700 }}>⭐ Interested: {r.interest}</div>
                  ) : r.salonViews > 0 ? (
                    <div style={{ color: "#0d6e5a", fontSize: 12, fontWeight: 600 }}>
                      👀 Opened{r.salonViews > 1 ? ` ${r.salonViews}×` : ""}{r.salonLastAt ? ` · ${fmt(r.salonLastAt)}` : ""}
                    </div>
                  ) : null}
                  {(() => {
                    const hasEngagement = !!r.interest || r.salonViews > 0;
                    const line = r.due
                      ? <span style={{ color: "#b45309", fontSize: 12, fontWeight: 700 }}>● Follow up now</span>
                      : r.status === "new"
                        ? <span style={{ color: "#A8873B", fontSize: 12 }}>Build the proposal</span>
                        : hasEngagement ? null : <span style={{ color: "#cbd5e1" }}>—</span>;
                    return line ? <div style={{ marginTop: hasEngagement ? 2 : 0 }}>{line}</div> : null;
                  })()}
                  {r.waitingDays !== null && r.waitingDays >= 1 && (
                    <div style={{
                      marginTop: 2, fontSize: 11, fontWeight: 600,
                      color: r.waitingDays >= 7 ? "#b91c1c" : r.waitingDays >= 3 ? "#b45309" : "#9CA3AF",
                    }}>
                      waiting {r.waitingDays}d
                    </div>
                  )}
                </td>

                {/* George's own notes - typed here, saved here */}
                <td style={td} onClick={(e) => e.stopPropagation()}>
                  <NotesCell id={r.id} initial={r.notes} />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 11.5, color: "#9CA3AF" }}>
        {shown.length} of {rows.length} requests · click a row to open it · search matches names, emails, areas and Ref codes
      </div>
    </>
  );
}

const th: React.CSSProperties = {
  padding: "10px 14px", fontSize: 10, letterSpacing: 2,
  textTransform: "uppercase", color: "#374151", fontWeight: 500,
};
const thCenter: React.CSSProperties = { ...th, textAlign: "center" };
const td: React.CSSProperties = { padding: "11px 14px", verticalAlign: "top" };
const tdCenter: React.CSSProperties = { ...td, textAlign: "center" };
