import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import OutreachClient from "./OutreachClient";

interface StatsSnapshot {
  total_sent: number;
  opens: number;
  replies: number;
  bounces: number;
  leads_remaining: number;
  active_followups: number;
  updated_at?: string;
  source?: string;
}

async function readBotSnapshot(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  bot: "george" | "elleanna"
): Promise<StatsSnapshot | null> {
  const { data } = await supabase
    .from("settings")
    .select("value, updated_at")
    .eq("key", `outreach_stats:${bot}`)
    .maybeSingle();
  if (!data?.value) return null;
  try {
    const parsed = JSON.parse(data.value as string) as StatsSnapshot;
    return { ...parsed, updated_at: (data.updated_at as string) ?? parsed.updated_at };
  } catch {
    return null;
  }
}

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
    snapshotRes,
    georgeBotRes,
    elleannaBotRes,
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
    // Snapshot of real bot stats (Total Sent / Opens / Replies / Bounces /
    // Leads Remaining / Active Follow-ups) updated manually by George or by
    // the bot itself via /api/outreach-stats POST.
    supabase
      .from("settings")
      .select("value, updated_at")
      .eq("key", "outreach_stats")
      .maybeSingle(),
    readBotSnapshot(supabase, "george"),
    readBotSnapshot(supabase, "elleanna"),
  ]);

  const total = totalRes.count ?? 0;
  const newCount = newRes.count ?? 0;
  const contactedCount = contactedRes.count ?? 0;
  const warmCount = warmRes.count ?? 0;
  const hotCount = hotRes.count ?? 0;
  const wonCount = wonRes.count ?? 0;
  const lostCount = lostRes.count ?? 0;

  // Parse the snapshot (if set) — it's authoritative for stats the CRM can't
  // derive from the contacts table (Opens, Bounces, true Leads Remaining from
  // the sheet, etc). Fall back to CRM-derived numbers only when no snapshot
  // has been saved yet.
  let snapshot: StatsSnapshot | null = null;
  if (snapshotRes?.data?.value) {
    try {
      snapshot = JSON.parse(snapshotRes.data.value) as StatsSnapshot;
      if (snapshotRes.data.updated_at) {
        snapshot.updated_at = snapshotRes.data.updated_at;
      }
    } catch {
      snapshot = null;
    }
  }

  const derivedTotalSent = total - newCount;
  const derivedReplyRate =
    derivedTotalSent > 0 ? ((warmCount + hotCount) / derivedTotalSent) * 100 : 0;

  const totalSent = snapshot?.total_sent ?? derivedTotalSent;
  const opens = snapshot?.opens ?? 0;
  const replies = snapshot?.replies ?? warmCount + hotCount;
  const bounces = snapshot?.bounces ?? 0;
  const leadsRemaining = snapshot?.leads_remaining ?? newCount;
  const activeFollowups = snapshot?.active_followups ?? contactedCount;
  const replyRate =
    totalSent > 0 ? (replies / totalSent) * 100 : derivedReplyRate;

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
      opens={opens}
      replies={replies}
      bounces={bounces}
      replyRate={replyRate}
      leadsRemaining={leadsRemaining}
      activeFollowups={activeFollowups}
      pipelineBreakdown={pipelineBreakdown}
      recentContacts={recentContacts}
      totalContacts={total}
      hasSnapshot={!!snapshot}
      snapshotUpdatedAt={snapshot?.updated_at ?? null}
      snapshotSource={snapshot?.source ?? null}
      perBot={{ george: georgeBotRes, elleanna: elleannaBotRes }}
    />
  );
}
