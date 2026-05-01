import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import VisitorsClient from "./VisitorsClient";

export default async function VisitorsPage() {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);

  // Athens-aware "today" + Monday-start "week". Vercel runs in UTC, so
  // naive `new Date(yyyy, mm, dd)` gave UTC midnight which mis-bucketed
  // 21:00–23:59 Athens sessions. We resolve "what is today's wall-clock
  // date in Athens", then build a UTC ISO instant that represents that
  // Athens-local midnight.
  function athensDateParts(d: Date): { y: number; m: number; day: number; dow: number } {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Athens",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(d).map((p) => [p.type, p.value]),
    );
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      y: Number(parts.year),
      m: Number(parts.month),
      day: Number(parts.day),
      dow: dowMap[parts.weekday] ?? 0,
    };
  }
  function athensMidnightIso(d: Date, daysOffset = 0): string {
    const p = athensDateParts(d);
    // Athens midnight on (y, m, day + offset). Build UTC instant by
    // taking that midnight in Athens TZ — Athens is UTC+2 (winter) or
    // UTC+3 (summer), Date.UTC + a probe offset handles DST.
    const probe = new Date(Date.UTC(p.y, p.m - 1, p.day + daysOffset, 0, 0, 0));
    // Compute Athens offset for that probe instant
    const athensOffsetMin = -new Date(
      probe.toLocaleString("en-US", { timeZone: "Europe/Athens" }),
    ).getTime() / 60000 +
      probe.getTime() / 60000;
    return new Date(probe.getTime() - athensOffsetMin * 60000).toISOString();
  }
  const today = new Date();
  const { dow } = athensDateParts(today);
  const daysSinceMonday = (dow + 6) % 7; // 0 if Monday, 6 if Sunday
  const todayStart = athensMidnightIso(today, 0);
  const weekStart = athensMidnightIso(today, -daysSinceMonday);

  // Fetch all data in parallel
  const [sessionsRes, todayRes, weekRes, hotRes, capturedRes] = await Promise.all([
    // Last 50 sessions with optional contact join
    supabase
      .from("sessions")
      .select("*, contact:contacts(id, first_name, last_name, company)")
      .order("started_at", { ascending: false })
      .limit(50),
    // Today count
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", todayStart),
    // This week count
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", weekStart),
    // Hot leads
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("is_hot_lead", true)
      .gte("started_at", weekStart),
    // Captured
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("lead_captured", true)
      .gte("started_at", weekStart),
  ]);

  const sessions = (sessionsRes.data ?? []).map((s) => ({
    id: s.id,
    session_id: s.session_id,
    contact_id: s.contact_id,
    country: s.country,
    city: s.city,
    device_type: s.device_type,
    referrer: s.referrer,
    pages_visited: s.pages_visited ?? [],
    yachts_viewed: s.yachts_viewed ?? [],
    time_on_site: s.time_on_site ?? 0,
    is_hot_lead: s.is_hot_lead ?? false,
    lead_captured: s.lead_captured ?? false,
    is_return_visitor: s.is_return_visitor ?? false,
    started_at: s.started_at,
    ended_at: s.ended_at,
    contact: s.contact
      ? {
          id: s.contact.id,
          first_name: s.contact.first_name,
          last_name: s.contact.last_name,
          company: s.contact.company,
        }
      : null,
  }));

  // Aggregate top yachts
  const yachtCounts: Record<string, number> = {};
  for (const s of sessions) {
    for (const y of s.yachts_viewed) {
      const name = typeof y === "string" ? y : y.name;
      if (name) {
        yachtCounts[name] = (yachtCounts[name] || 0) + 1;
      }
    }
  }
  const topYachts = Object.entries(yachtCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return (
    <VisitorsClient
      initialSessions={sessions}
      visitorsToday={todayRes.count ?? 0}
      visitorsWeek={weekRes.count ?? 0}
      hotLeads={hotRes.count ?? 0}
      captured={capturedRes.count ?? 0}
      topYachts={topYachts}
    />
  );
}
