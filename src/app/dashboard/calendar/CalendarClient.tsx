"use client";

import { useCallback, useEffect, useState } from "react";
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

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function CalendarClient() {
  const [view, setView] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null
  );
  const [matchedContactId, setMatchedContactId] = useState<string | null>(null);

  const today = new Date();

  // ── Compute date range ──
  const getRange = useCallback((): { start: Date; end: Date } => {
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
  }, [view, currentDate]);

  // ── Fetch events ──
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

  // ── Check if selected event attendee matches a CRM contact ──
  useEffect(() => {
    if (!selectedEvent || selectedEvent.attendees.length === 0) {
      setMatchedContactId(null);
      return;
    }
    const emails = selectedEvent.attendees.map((a) => a.email);
    // Try each attendee
    Promise.all(
      emails.map((email) =>
        fetch(`/api/crm/contacts?email=${encodeURIComponent(email)}`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [])
      )
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

  // ── Navigation ──
  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "week") d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  };

  const goToday = () => setCurrentDate(new Date());

  // ── Get events for a specific day ──
  const getEventsForDay = (date: Date) =>
    events.filter((evt) => {
      const evtDate = new Date(evt.start);
      return isSameDay(evtDate, date);
    });

  // ── Title ──
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
      return `${startStr} \u2013 ${endStr}`;
    }
    return currentDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  })();

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-navy-lighter px-6 py-4">
        <div className="flex items-center gap-4">
          <div>
            <div className="mb-1 inline-flex rounded border border-hot-red/30 bg-hot-red/10 px-2 py-0.5">
              <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[3px] text-hot-red uppercase">RESTRICTED</span>
            </div>
            <h1 className="font-[family-name:var(--font-mono)] text-xl font-black tracking-[3px] text-electric-cyan uppercase">
              MISSION SCHEDULER
            </h1>
          </div>
          {loading && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Today button */}
          <button
            onClick={goToday}
            className="rounded-lg border border-navy-lighter px-3 py-1.5 text-sm font-medium text-ivory/60 transition-colors hover:text-ivory"
          >
            Today
          </button>

          {/* Prev/Next */}
          <div className="flex items-center rounded-lg border border-navy-lighter">
            <button
              onClick={() => navigate(-1)}
              className="px-2 py-1.5 text-ivory/60 hover:text-ivory"
              aria-label="Previous"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </button>
            <div className="h-5 w-px bg-navy-lighter" />
            <button
              onClick={() => navigate(1)}
              className="px-2 py-1.5 text-ivory/60 hover:text-ivory"
              aria-label="Next"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
              </svg>
            </button>
          </div>

          {/* View toggle */}
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

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto">
        {view === "month" && <MonthView currentDate={currentDate} today={today} events={events} getEventsForDay={getEventsForDay} onSelectEvent={setSelectedEvent} />}
        {view === "week" && <WeekView currentDate={currentDate} today={today} events={events} onSelectEvent={setSelectedEvent} />}
        {view === "day" && <DayView currentDate={currentDate} today={today} events={events} onSelectEvent={setSelectedEvent} />}
      </div>

      {/* Event detail popup */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedEvent(null)}>
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
                  {formatTime(selectedEvent.start)} &ndash;{" "}
                  {formatTime(selectedEvent.end)}
                </span>
              </div>

              {selectedEvent.description && (
                <p className="text-ivory/50">{selectedEvent.description.slice(0, 200)}</p>
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
                        <span className="text-xs text-ivory/30">
                          ({a.status})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {matchedContactId && (
                <Link
                  href={`/dashboard/contacts?id=${matchedContactId}`}
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

// ─── Month View ──────────────────────────────────────────────────────────────

function MonthView({
  currentDate,
  today,
  events: _events,
  getEventsForDay,
  onSelectEvent,
}: {
  currentDate: Date;
  today: Date;
  events: CalendarEvent[];
  getEventsForDay: (d: Date) => CalendarEvent[];
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  void _events; // used via getEventsForDay
  const monthStart = startOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="h-full">
      {/* Day headers */}
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

      {/* Cells */}
      <div className="grid h-[calc(100%-32px)] grid-cols-7 grid-rows-6">
        {days.map((day, i) => {
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const isToday = isSameDay(day, today);
          const dayEvents = getEventsForDay(day);

          return (
            <div
              key={i}
              className={`border-b border-r border-[rgba(255,255,255,0.05)] p-1 ${
                isCurrentMonth ? "" : "opacity-30"
              } ${isToday ? "ring-1 ring-inset ring-gold/40" : ""}`}
            >
              <div
                className={`mb-0.5 text-right text-xs ${
                  isToday
                    ? "font-bold text-gold"
                    : "text-ivory/50"
                }`}
              >
                {day.getDate()}
              </div>
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
      {/* Day headers */}
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

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[60px_repeat(7,1fr)]">
          {HOURS.map((hour) => (
            <div key={hour} className="contents">
              {/* Time label */}
              <div className="relative h-16 border-b border-[rgba(255,255,255,0.03)] pr-2 text-right">
                <span className="absolute -top-2 right-2 text-[10px] text-ivory/30">
                  {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                </span>
              </div>

              {/* Day columns */}
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
      {/* Day header */}
      <div className="border-b border-navy-lighter px-6 py-3">
        <span className={`text-sm font-medium ${isToday ? "text-gold" : "text-ivory/50"}`}>
          {DAYS_SHORT[currentDate.getDay()]}{" "}
          <span className={`text-2xl font-bold ${isToday ? "text-gold" : "text-ivory"}`}>
            {currentDate.getDate()}
          </span>
        </span>
      </div>

      {/* Time grid */}
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
                        {formatTime(evt.start)} &ndash; {formatTime(evt.end)}
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
