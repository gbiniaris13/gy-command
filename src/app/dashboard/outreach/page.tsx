import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import OutreachClient from "./OutreachClient";

export default async function OutreachPage() {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);

  // Fetch all data in parallel
  const [
    totalRes,
    stagesRes,
    newRes,
    contactedRes,
    warmRes,
    hotRes,
    wonRes,
    lostRes,
    recentRes,
  ] = await Promise.all([
    // Total outreach contacts
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("source", "outreach_bot"),
    // All stages for reference
    supabase
      .from("pipeline_stages")
      .select("id, name, color")
      .order("position", { ascending: true }),
    // New
    supabase
      .from("contacts")
      .select("id, pipeline_stage:pipeline_stages!inner(name)", { count: "exact", head: true })
      .eq("source", "outreach_bot")
      .eq("pipeline_stages.name", "New"),
    // Contacted
    supabase
      .from("contacts")
      .select("id, pipeline_stage:pipeline_stages!inner(name)", { count: "exact", head: true })
      .eq("source", "outreach_bot")
      .eq("pipeline_stages.name", "Contacted"),
    // Warm
    supabase
      .from("contacts")
      .select("id, pipeline_stage:pipeline_stages!inner(name)", { count: "exact", head: true })
      .eq("source", "outreach_bot")
      .eq("pipeline_stages.name", "Warm"),
    // Hot
    supabase
      .from("contacts")
      .select("id, pipeline_stage:pipeline_stages!inner(name)", { count: "exact", head: true })
      .eq("source", "outreach_bot")
      .eq("pipeline_stages.name", "Hot"),
    // Won
    supabase
      .from("contacts")
      .select("id, pipeline_stage:pipeline_stages!inner(name)", { count: "exact", head: true })
      .eq("source", "outreach_bot")
      .eq("pipeline_stages.name", "Won"),
    // Lost
    supabase
      .from("contacts")
      .select("id, pipeline_stage:pipeline_stages!inner(name)", { count: "exact", head: true })
      .eq("source", "outreach_bot")
      .eq("pipeline_stages.name", "Lost"),
    // Recent 20 outreach contacts
    supabase
      .from("contacts")
      .select("*, pipeline_stage:pipeline_stages(*)")
      .eq("source", "outreach_bot")
      .order("last_activity_at", { ascending: false })
      .limit(20),
  ]);

  const total = totalRes.count ?? 0;
  const newCount = newRes.count ?? 0;
  const contactedCount = contactedRes.count ?? 0;
  const warmCount = warmRes.count ?? 0;
  const hotCount = hotRes.count ?? 0;
  const wonCount = wonRes.count ?? 0;
  const lostCount = lostRes.count ?? 0;

  const totalSent = total - newCount;
  const replyRate = totalSent > 0 ? ((warmCount + hotCount) / totalSent) * 100 : 0;

  const pipelineBreakdown = [
    { name: "New", count: newCount, color: "#6B7280" },
    { name: "Contacted", count: contactedCount, color: "#3B82F6" },
    { name: "Warm", count: warmCount, color: "#F59E0B" },
    { name: "Hot", count: hotCount, color: "#EF4444" },
    { name: "Won", count: wonCount, color: "#22C55E" },
    { name: "Lost", count: lostCount, color: "#9CA3AF" },
  ];

  const recentContacts = (recentRes.data ?? []).map((c) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    company: c.company,
    country: c.country,
    linkedin_url: c.linkedin_url,
    last_activity_at: c.last_activity_at,
    pipeline_stage: c.pipeline_stage,
  }));

  return (
    <OutreachClient
      totalSent={totalSent}
      replyRate={replyRate}
      leadsRemaining={newCount}
      activeFollowups={contactedCount}
      pipelineBreakdown={pipelineBreakdown}
      recentContacts={recentContacts}
      totalContacts={total}
    />
  );
}
