import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireUser } from "@/lib/require-user";

/**
 * GET /api/crm/sessions?limit=50
 * Returns latest visitor sessions for the real-time feed auto-refresh.
 */
export async function GET(request: NextRequest) {
  const denied = await requireUser(request);
  if (denied) return denied;
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

    // 2026-05-14 — expose every new visitor-intelligence column so
    // the auto-refresh polling delivers the same payload shape as
    // the initial server-render in `page.tsx`.
    const sessions = (sessionsRes.data ?? []).map((s) => ({
      id: s.id,
      session_id: s.session_id,
      visitor_id: s.visitor_id ?? null,
      contact_id: s.contact_id,
      country: s.country,
      region: s.region ?? null,
      city: s.city,
      postal: s.postal ?? null,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
      timezone: s.timezone ?? null,
      device_type: s.device_type,
      device_tier: s.device_tier ?? null,
      os: s.os ?? null,
      os_version: s.os_version ?? null,
      browser: s.browser ?? null,
      browser_version: s.browser_version ?? null,
      locale: s.locale ?? null,
      ip_company: s.ip_company ?? null,
      ip_asn: s.ip_asn ?? null,
      ip_asn_name: s.ip_asn_name ?? null,
      ip_is_vpn: s.ip_is_vpn ?? null,
      ip_is_hosting: s.ip_is_hosting ?? null,
      referrer: s.referrer,
      referrer_url: s.referrer_url ?? null,
      utm_source: s.utm_source ?? null,
      utm_medium: s.utm_medium ?? null,
      utm_campaign: s.utm_campaign ?? null,
      utm_content: s.utm_content ?? null,
      gclid: s.gclid ?? null,
      fbclid: s.fbclid ?? null,
      li_fat_id: s.li_fat_id ?? null,
      pages_visited: s.pages_visited ?? [],
      yachts_viewed: s.yachts_viewed ?? [],
      premium_yacht_views: s.premium_yacht_views ?? 0,
      time_on_site: s.time_on_site ?? 0,
      active_seconds: s.active_seconds ?? null,
      hidden_seconds: s.hidden_seconds ?? null,
      cta_clicks: s.cta_clicks ?? 0,
      last_cta: s.last_cta ?? null,
      scroll_deep: s.scroll_deep ?? false,
      copy_events: s.copy_events ?? 0,
      print_events: s.print_events ?? 0,
      compare_used: s.compare_used ?? false,
      cost_calc_used: s.cost_calc_used ?? false,
      yacht_finder_used: s.yacht_finder_used ?? false,
      pricing_calendar_used: s.pricing_calendar_used ?? false,
      hot_score: s.hot_score ?? null,
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
