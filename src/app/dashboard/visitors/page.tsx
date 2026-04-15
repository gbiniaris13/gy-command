import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import VisitorsClient from "./VisitorsClient";

export default async function VisitorsPage() {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - now.getDay()
  ).toISOString();

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
