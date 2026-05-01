"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  attendees: { email: string; name: string; status: string }[];
  colorId: string;
  htmlLink: string;
}

interface Charter {
  id: string;
  vessel_name: string | null;
  start: string | null;
  end: string | null;
  guest_count: number | null;
  fee_eur: number | null;
  payment_status: string | null;
  lifecycle_status: string | null;
  contact_id: string | null;
  contact_name: string | null;
}

interface Props {
  charters: Charter[];
}

type Tab = "agenda" | "calendar" | "charters";
type ViewMode = "month" | "week" | "day";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startOfWeek(d: Date): Date {
  const result = new Date(d);
  const day = result.getDay();
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

function dayLabel(date: Date, today: Date): string {
  const tomorrow = addDays(today, 1);
  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, tomorrow)) return "Tomorrow";
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function formatCountdown(target: Date, now: Date): string {
  const diff = target.getTime() - now.getTime();
  if (diff < 0) return "started";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "any moment";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const remMins = mins - hours * 60;
    return remMins > 0 ? `in ${hours}h ${remMins}m` : `in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

function getEventColor(event: CalendarEvent): {
  bg: string;
  border: string;
  text: string;
} {
  const s = (event.summary ?? "").toLowerCase();
  if (s.includes("charter") || s.includes("yacht") || s.includes("showing")) {
    return {
      bg: "bg-gold/20",
      border: "border-gold/40",
      text: "text-gold",
    };
  }
  if (s.includes("meeting") || s.includes("call") || s.includes("demo")) {
    return {
      bg: "bg-blue-500/20",
      border: "border-blue-500/40",
      text: "text-blue-400",
    };
  }
  return {
    bg: "bg-gray-500/15",
    border: "border-gray-500/30",
    text: "text-ivory/70",
  };
}

// Charter status pill styling
function charterPill(status: string | null): { label: string; cls: string } {
  const s = (status ?? "").toLowerCase();
  if (s === "active" || s === "in_progress")
    return {
      label: "🛳 Sailing",
      cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    };
  if (s === "completed")
    return {
      label: "✅ Done",
      cls: "bg-gray-500/20 text-gray-300 border-gray-500/40",
    };
  if (s === "cancelled")
    return {
      label: "✗ Cancelled",
      cls: "bg-hot-red/20 text-hot-red border-hot-red/40",
    };
  return {
    label: "⏳ Confirmed",
    cls: "bg-gold/20 text-gold border-gold/40",
  };
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function CalendarClient({ charters }: Props) {
  const [tab, setTab] = useState<Tab>("agenda");
  const [view, setView] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );
  const [matchedContactId, setMatchedContactId] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());

  // Tick the clock every 30s so countdowns refresh without a page reload
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Compute active fetch range based on tab + view
  const getRange = useCallback((): { start: Date; end: Date } => {
    if (tab === "agenda") {
      // Pull next 14 days regardless of grid view
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { start, end: addDays(start, 14) };
    }
    if (view === "week") {
      const start = startOfWeek(currentDate);
      return { start, end: addDays(start, 7) };
    }
    if (view === "day") {
      const start = new Date(currentDate);
      start.setHours(0, 0, 0, 0);
      return { start, end: addDays(start, 1) };
    }
    // month
    const monthStart = startOfMonth(currentDate);
    const start = startOfWeek(monthStart);
    return { start, end: addDays(start, 42) };
  }, [tab, view, currentDate]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const { start, end } = getRange();
      const params = new URLSearchParams({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
      });
      const res = await fetch(`/api/calendar/events?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch calendar events:", err);
    } finally {
      setLoading(false);
    }
  }, [getRange]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Resolve matched CRM contact for the popup
  useEffect(() => {
    if (!selectedEvent || selectedEvent.attendees.length === 0) {
      setMatchedContactId(null);
      return;
    }
    const emails = selectedEvent.attendees.map((a) => a.email);
    Promise.all(
      emails.map((email) =>
        fetch(`/api/crm/contacts?email=${encodeURIComponent(email)}`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
      ),
    ).then((results) => {
      for (const contacts of results) {
        if (contacts?.length) {
          setMatchedContactId(contacts[0].id);
          return;
        }
      }
      setMatchedContactId(null);
    });
  }, [selectedEvent]);

  // ── Navigation (only relevant for Calendar tab) ──
  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "week") d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  };

  const goToday = () => setCurrentDate(new Date());

  const getEventsForDay = (date: Date) =>
    events.filter((evt) => {
      const evtDate = new Date(evt.start);
      return isSameDay(evtDate, date);
    });

  // Active charters covering a specific day (overlay on calendar grids)
  const chartersForDay = useCallback(
    (date: Date) =>
      charters.filter((c) => {
        if (!c.start) return false;
        const s = new Date(c.start);
        const e = c.end ? new Date(c.end) : s;
        return date >= new Date(s.toDateString()) && date <= new Date(e.toDateString());
      }),
    [charters],
  );

  // Title for the calendar tab toolbar
  const title = (() => {
    if (view === "month")
      return `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    if (view === "week") {
      const start = startOfWeek(currentDate);
      const end = addDays(start, 6);
      const startStr = start.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const endStr = end.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return `${startStr} – ${endStr}`;
    }
    return currentDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  })();

  // ─── Agenda tab data ───────────────────────────────────────────────────────

  // Group events by day for the next 14 days
  const agenda = useMemo(() => {
    const days: { date: Date; events: CalendarEvent[]; charters: Charter[] }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = addDays(today, i);
      days.push({
        date: d,
        events: events
          .filter((evt) => isSameDay(new Date(evt.start), d))
          .sort(
            (a, b) =>
              new Date(a.start).getTime() - new Date(b.start).getTime(),
          ),
        charters: chartersForDay(d),
      });
    }
    return days;
  }, [events, today, chartersForDay]);

  // The single next event (for the countdown banner)
  const nextEvent = useMemo(() => {
    return events
      .filter((evt) => new Date(evt.start) > now)
      .sort(
        (a, b) =>
          new Date(a.start).getTime() - new Date(b.start).getTime(),
      )[0];
  }, [events, now]);

  // ─── Charters tab data ─────────────────────────────────────────────────────

  const charterBuckets = useMemo(() => {
    const upcoming: Charter[] = [];
    const active: Charter[] = [];
    const past: Charter[] = [];
    for (const c of charters) {
      if (!c.start) {
        upcoming.push(c);
        continue;
      }
      const s = new Date(c.start);
      const e = c.end ? new Date(c.end) : s;
      if (now > e) past.push(c);
      else if (now < s) upcoming.push(c);
      else active.push(c);
    }
    return { upcoming, active, past };
  }, [charters, now]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-navy-lighter px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="mb-1 inline-flex rounded border border-electric-cyan/30 bg-electric-cyan/10 px-2 py-0.5">
              <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[3px] text-electric-cyan uppercase">
                MISSION SCHEDULER
              </span>
            </div>
            <h1 className="font-[family-name:var(--font-mono)] text-xl font-black tracking-[3px] text-electric-cyan uppercase">
              CALENDAR
            </h1>
          </div>
          {loading && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
          )}
        </div>

        {/* Tabs */}
        <div className="mt-3 flex gap-1 rounded-lg border border-border-glow bg-glass-dark p-1 w-fit">
          {(
            [
              { k: "agenda" as Tab, label: "Agenda" },
              { k: "calendar" as Tab, label: "Calendar" },
              { k: "charters" as Tab, label: "Charters" },
            ]
          ).map((t) => {
            const active = tab === t.k;
            const count =
              t.k === "charters"
                ? charters.length
                : t.k === "agenda"
                  ? events.filter((e) => new Date(e.start) > now).length
                  : 0;
            return (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`shrink-0 rounded px-3 py-2 font-[family-name:var(--font-mono)] text-[11px] font-bold tracking-wider uppercase transition-colors ${
                  active
                    ? "bg-electric-cyan/15 text-electric-cyan border border-electric-cyan/30"
                    : "text-muted-blue hover:text-soft-white border border-transparent"
                }`}
              >
                {t.label}
                {count > 0 && (
                  <span
                    className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] ${
                      active
                        ? "bg-electric-cyan/20 text-electric-cyan"
                        : "bg-glass-light text-muted-blue/60"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {tab === "agenda" && (
          <AgendaTab
            agenda={agenda}
            today={today}
            now={now}
            nextEvent={nextEvent}
            onSelectEvent={setSelectedEvent}
          />
        )}

        {tab === "calendar" && (
          <>
            {/* Calendar toolbar (only here) */}
            <div className="flex items-center justify-between border-b border-navy-lighter px-6 py-3 bg-glass-dark">
              <div className="font-[family-name:var(--font-mono)] text-sm font-bold text-soft-white tracking-wider">
                {title}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={goToday}
                  className="rounded-lg border border-navy-lighter px-3 py-1.5 text-sm font-medium text-ivory/60 hover:text-ivory"
                >
                  Today
                </button>
                <div className="flex items-center rounded-lg border border-navy-lighter">
                  <button
                    onClick={() => navigate(-1)}
                    className="px-2 py-1.5 text-ivory/60 hover:text-ivory"
                    aria-label="Previous"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                  <div className="h-5 w-px bg-navy-lighter" />
                  <button
                    onClick={() => navigate(1)}
                    className="px-2 py-1.5 text-ivory/60 hover:text-ivory"
                    aria-label="Next"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-center rounded-lg border border-navy-lighter">
                  {(["month", "week", "day"] as ViewMode[]).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                        view === v
                          ? "bg-gold/20 text-gold"
                          : "text-ivory/50 hover:text-ivory"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {view === "month" && (
              <MonthView
                currentDate={currentDate}
                today={today}
                events={events}
                getEventsForDay={getEventsForDay}
                chartersForDay={chartersForDay}
                onSelectEvent={setSelectedEvent}
              />
            )}
            {view === "week" && (
              <WeekView
                currentDate={currentDate}
                today={today}
                events={events}
                onSelectEvent={setSelectedEvent}
              />
            )}
            {view === "day" && (
              <DayView
                currentDate={currentDate}
                today={today}
                events={events}
                onSelectEvent={setSelectedEvent}
              />
            )}
          </>
        )}

        {tab === "charters" && (
          <ChartersTab buckets={charterBuckets} now={now} />
        )}
      </div>

      {/* Event detail popup */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-navy-lighter bg-navy-light p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <h3 className="font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory">
                {selectedEvent.summary}
              </h3>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-ivory/40 hover:text-ivory"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-ivory/60">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  {formatTime(selectedEvent.start)} – {formatTime(selectedEvent.end)}
                </span>
              </div>
              {selectedEvent.description && (
                <p className="text-ivory/50">
                  {selectedEvent.description.slice(0, 200)}
                </p>
              )}
              {selectedEvent.attendees.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-ivory/40">
                    Attendees
                  </p>
                  <div className="space-y-1">
                    {selectedEvent.attendees.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 text-ivory/60">
                        <div className="h-1.5 w-1.5 rounded-full bg-gold/60" />
                        <span>{a.name || a.email}</span>
                        <span className="text-xs text-ivory/30">({a.status})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {matchedContactId && (
                <Link
                  href={`/dashboard/contacts/${matchedContactId}`}
                  className="mt-2 inline-flex items-center gap-1 rounded border border-gold/30 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/10"
                >
                  View Contact in CRM
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Agenda Tab ──────────────────────────────────────────────────────────────

function AgendaTab({
  agenda,
  today,
  now,
  nextEvent,
  onSelectEvent,
}: {
  agenda: { date: Date; events: CalendarEvent[]; charters: Charter[] }[];
  today: Date;
  now: Date;
  nextEvent: CalendarEvent | undefined;
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  const totalEvents = agenda.reduce((s, d) => s + d.events.length, 0);

  return (
    <div className="p-6">
      {nextEvent && (
        <div className="mb-6 rounded-xl border border-electric-cyan/30 bg-electric-cyan/5 p-5">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-electric-cyan/70 uppercase">
            ⏱ Next event
          </p>
          <button
            onClick={() => onSelectEvent(nextEvent)}
            className="mt-2 block w-full text-left"
          >
            <p className="font-[family-name:var(--font-display)] text-2xl font-bold text-soft-white">
              {nextEvent.summary}
            </p>
            <p className="mt-1 text-sm text-electric-cyan">
              {formatCountdown(new Date(nextEvent.start), now)} ·{" "}
              {formatTime(nextEvent.start)}
            </p>
          </button>
        </div>
      )}

      {totalEvents === 0 && agenda.every((d) => d.charters.length === 0) ? (
        <div className="rounded-xl border border-border-glow bg-glass-dark p-8 text-center">
          <p className="text-2xl mb-2">📅</p>
          <p className="font-[family-name:var(--font-display)] text-lg text-soft-white">
            Clear runway for the next 14 days
          </p>
          <p className="mt-2 text-sm text-muted-blue">
            No calendar events or charters scheduled. Use this time wisely.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {agenda
            .filter((d) => d.events.length > 0 || d.charters.length > 0)
            .map((day) => (
              <div
                key={day.date.toISOString()}
                className="rounded-xl border border-border-glow bg-glass-dark p-4"
              >
                <div className="mb-3 flex items-baseline justify-between">
                  <p className="font-[family-name:var(--font-mono)] text-[12px] font-bold tracking-[2px] text-electric-cyan uppercase">
                    {dayLabel(day.date, today)}
                  </p>
                  {(day.events.length > 0 || day.charters.length > 0) && (
                    <p className="text-[11px] text-muted-blue/60">
                      {day.events.length} event
                      {day.events.length === 1 ? "" : "s"}
                      {day.charters.length > 0 &&
                        ` · ${day.charters.length} charter${day.charters.length === 1 ? "" : "s"} on water`}
                    </p>
                  )}
                </div>

                {day.charters.length > 0 && (
                  <div className="mb-3 space-y-1">
                    {day.charters.map((c) => {
                      const pill = charterPill(c.lifecycle_status);
                      return (
                        <div
                          key={c.id}
                          className={`flex items-center justify-between rounded border px-3 py-2 ${pill.cls}`}
                        >
                          <span className="text-sm font-medium">
                            {c.vessel_name ?? "Vessel"}
                            {c.contact_name && (
                              <span className="opacity-70"> · {c.contact_name}</span>
                            )}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider opacity-80">
                            {pill.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {day.events.length > 0 && (
                  <div className="space-y-1">
                    {day.events.map((evt) => {
                      const color = getEventColor(evt);
                      return (
                        <button
                          key={evt.id}
                          onClick={() => onSelectEvent(evt)}
                          className={`flex w-full items-center justify-between rounded px-3 py-2 text-left ${color.bg} ${color.text} border ${color.border} hover:opacity-90`}
                        >
                          <span className="text-sm font-medium truncate flex-1">
                            {evt.summary}
                          </span>
                          <span className="ml-3 shrink-0 text-xs opacity-80">
                            {formatTime(evt.start)} – {formatTime(evt.end)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Charters Tab ────────────────────────────────────────────────────────────

function ChartersTab({
  buckets,
  now,
}: {
  buckets: { upcoming: Charter[]; active: Charter[]; past: Charter[] };
  now: Date;
}) {
  const renderRow = (c: Charter) => {
    const pill = charterPill(c.lifecycle_status);
    const startD = c.start ? new Date(c.start) : null;
    const endD = c.end ? new Date(c.end) : startD;
    const range =
      startD && endD
        ? `${startD.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${endD.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
        : "—";

    let countdown = "";
    if (startD && now < startD) {
      countdown = formatCountdown(startD, now);
    } else if (endD && now <= endD) {
      const remaining = Math.ceil(
        (endD.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      countdown = remaining > 0 ? `${remaining} days remaining` : "ends today";
    }

    return (
      <Link
        key={c.id}
        href={`/dashboard/charters/${c.id}`}
        className="block rounded-lg border border-border-glow bg-glass-dark p-4 hover:border-electric-cyan/30"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-[family-name:var(--font-display)] text-base font-semibold text-soft-white truncate">
              {c.vessel_name ?? "Vessel TBD"}
              {c.contact_name && (
                <span className="text-muted-blue font-normal"> · {c.contact_name}</span>
              )}
            </p>
            <p className="mt-1 text-[12px] text-muted-blue">
              {range}
              {c.guest_count && (
                <span className="opacity-80"> · {c.guest_count} guests</span>
              )}
              {c.fee_eur && (
                <span className="opacity-80">
                  {" "}
                  · €{Math.round(c.fee_eur).toLocaleString()}
                </span>
              )}
            </p>
            {countdown && (
              <p className="mt-1 text-[11px] font-medium text-electric-cyan">
                {countdown}
              </p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${pill.cls}`}
          >
            {pill.label}
          </span>
        </div>
      </Link>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {buckets.active.length > 0 && (
        <section>
          <h2 className="mb-3 font-[family-name:var(--font-mono)] text-[11px] font-bold tracking-[2px] text-emerald-300 uppercase">
            🛳 Currently sailing ({buckets.active.length})
          </h2>
          <div className="space-y-2">{buckets.active.map(renderRow)}</div>
        </section>
      )}

      {buckets.upcoming.length > 0 && (
        <section>
          <h2 className="mb-3 font-[family-name:var(--font-mono)] text-[11px] font-bold tracking-[2px] text-gold uppercase">
            ⏳ Upcoming ({buckets.upcoming.length})
          </h2>
          <div className="space-y-2">{buckets.upcoming.map(renderRow)}</div>
        </section>
      )}

      {buckets.past.length > 0 && (
        <section>
          <h2 className="mb-3 font-[family-name:var(--font-mono)] text-[11px] font-bold tracking-[2px] text-muted-blue uppercase">
            ✓ Recently completed ({buckets.past.length})
          </h2>
          <div className="space-y-2">{buckets.past.map(renderRow)}</div>
        </section>
      )}

      {buckets.active.length === 0 &&
        buckets.upcoming.length === 0 &&
        buckets.past.length === 0 && (
          <div className="rounded-xl border border-border-glow bg-glass-dark p-8 text-center">
            <p className="text-2xl mb-2">⚓</p>
            <p className="font-[family-name:var(--font-display)] text-lg text-soft-white">
              No charters in the next 12 months
            </p>
            <p className="mt-2 text-sm text-muted-blue">
              When deals get a charter_start_date, they show up here.
            </p>
          </div>
        )}
    </div>
  );
}

// ─── Month View ──────────────────────────────────────────────────────────────

function MonthView({
  currentDate,
  today,
  events: _events,
  getEventsForDay,
  chartersForDay,
  onSelectEvent,
}: {
  currentDate: Date;
  today: Date;
  events: CalendarEvent[];
  getEventsForDay: (d: Date) => CalendarEvent[];
  chartersForDay: (d: Date) => Charter[];
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  void _events;
  const monthStart = startOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="h-full">
      <div className="grid grid-cols-7 border-b border-navy-lighter">
        {DAYS_SHORT.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-xs font-medium text-ivory/40"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid h-[calc(100%-32px)] grid-cols-7 grid-rows-6">
        {days.map((day, i) => {
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const isToday = isSameDay(day, today);
          const dayEvents = getEventsForDay(day);
          const dayCharters = chartersForDay(day);

          return (
            <div
              key={i}
              className={`border-b border-r border-[rgba(255,255,255,0.05)] p-1 ${
                isCurrentMonth ? "" : "opacity-30"
              } ${isToday ? "ring-1 ring-inset ring-gold/40" : ""}`}
            >
              <div
                className={`mb-0.5 text-right text-xs ${
                  isToday ? "font-bold text-gold" : "text-ivory/50"
                }`}
              >
                {day.getDate()}
              </div>
              {/* Charter overlay strip */}
              {dayCharters.length > 0 && (
                <div className="mb-0.5 flex gap-0.5">
                  {dayCharters.slice(0, 3).map((c) => (
                    <div
                      key={c.id}
                      className="h-1 flex-1 rounded-full bg-emerald-400/60"
                      title={`${c.vessel_name ?? "Charter"} · ${c.contact_name ?? ""}`}
                    />
                  ))}
                </div>
              )}
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((evt) => {
                  const color = getEventColor(evt);
                  return (
                    <button
                      key={evt.id}
                      onClick={() => onSelectEvent(evt)}
                      className={`w-full truncate rounded px-1 py-0.5 text-left text-[10px] ${color.bg} ${color.text} border ${color.border}`}
                    >
                      {formatTime(evt.start)} {evt.summary}
                    </button>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-ivory/30 pl-1">
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Week View ───────────────────────────────────────────────────────────────

function WeekView({
  currentDate,
  today,
  events,
  onSelectEvent,
}: {
  currentDate: Date;
  today: Date;
  events: CalendarEvent[];
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  const weekStart = startOfWeek(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-navy-lighter">
        <div />
        {days.map((day, i) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={i}
              className={`px-2 py-2 text-center ${
                isToday ? "text-gold" : "text-ivory/50"
              }`}
            >
              <div className="text-xs font-medium">{DAYS_SHORT[day.getDay()]}</div>
              <div className={`text-lg font-bold ${isToday ? "text-gold" : "text-ivory/70"}`}>
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[60px_repeat(7,1fr)]">
          {HOURS.map((hour) => (
            <div key={hour} className="contents">
              <div className="relative h-16 border-b border-[rgba(255,255,255,0.03)] pr-2 text-right">
                <span className="absolute -top-2 right-2 text-[10px] text-ivory/30">
                  {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                </span>
              </div>
              {days.map((day, di) => {
                const isToday = isSameDay(day, today);
                const cellEvents = events.filter((evt) => {
                  const evtDate = new Date(evt.start);
                  return isSameDay(evtDate, day) && evtDate.getHours() === hour;
                });
                return (
                  <div
                    key={di}
                    className={`relative h-16 border-b border-l border-[rgba(255,255,255,0.03)] ${
                      isToday ? "bg-gold/[0.03]" : ""
                    }`}
                  >
                    {cellEvents.map((evt) => {
                      const color = getEventColor(evt);
                      return (
                        <button
                          key={evt.id}
                          onClick={() => onSelectEvent(evt)}
                          className={`absolute inset-x-0.5 top-0.5 z-10 truncate rounded px-1 py-0.5 text-left text-[10px] ${color.bg} ${color.text} border ${color.border}`}
                        >
                          {formatTime(evt.start)} {evt.summary}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Day View ────────────────────────────────────────────────────────────────

function DayView({
  currentDate,
  today,
  events,
  onSelectEvent,
}: {
  currentDate: Date;
  today: Date;
  events: CalendarEvent[];
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  const isToday = isSameDay(currentDate, today);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-navy-lighter px-6 py-3">
        <span className={`text-sm font-medium ${isToday ? "text-gold" : "text-ivory/50"}`}>
          {DAYS_SHORT[currentDate.getDay()]}{" "}
          <span className={`text-2xl font-bold ${isToday ? "text-gold" : "text-ivory"}`}>
            {currentDate.getDate()}
          </span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {HOURS.map((hour) => {
          const hourEvents = events.filter((evt) => {
            const evtDate = new Date(evt.start);
            return isSameDay(evtDate, currentDate) && evtDate.getHours() === hour;
          });
          return (
            <div
              key={hour}
              className="flex border-b border-[rgba(255,255,255,0.03)]"
            >
              <div className="w-16 shrink-0 pr-2 pt-1 text-right text-xs text-ivory/30">
                {hour === 0
                  ? "12 AM"
                  : hour < 12
                    ? `${hour} AM`
                    : hour === 12
                      ? "12 PM"
                      : `${hour - 12} PM`}
              </div>
              <div className="min-h-[4rem] flex-1 p-1">
                {hourEvents.map((evt) => {
                  const color = getEventColor(evt);
                  return (
                    <button
                      key={evt.id}
                      onClick={() => onSelectEvent(evt)}
                      className={`mb-1 w-full rounded px-3 py-2 text-left ${color.bg} border ${color.border}`}
                    >
                      <div className={`text-sm font-medium ${color.text}`}>
                        {evt.summary}
                      </div>
                      <div className="text-xs text-ivory/40">
                        {formatTime(evt.start)} – {formatTime(evt.end)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
