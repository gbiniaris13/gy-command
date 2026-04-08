import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * GET /api/crm/sessions?limit=50
 * Returns latest visitor sessions for the real-time feed auto-refresh.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - now.getDay()
    ).toISOString();

    const [sessionsRes, todayRes, weekRes, hotRes, capturedRes] = await Promise.all([
      supabase
        .from("sessions")
        .select("*, contact:contacts(id, first_name, last_name, company)")
        .order("started_at", { ascending: false })
        .limit(limit),
      supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .gte("started_at", todayStart),
      supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .gte("started_at", weekStart),
      supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("is_hot_lead", true)
        .gte("started_at", weekStart),
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

    return NextResponse.json({
      sessions,
      stats: {
        today: todayRes.count ?? 0,
        week: weekRes.count ?? 0,
        hot: hotRes.count ?? 0,
        captured: capturedRes.count ?? 0,
      },
    });
  } catch (err) {
    console.error("[Sessions API] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
