import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import RevenueClient from "./RevenueClient";

interface DealRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  charter_vessel: string | null;
  charter_fee: number | null;
  commission_earned: number | null;
  commission_rate: number | null;
  payment_status: string | null;
  charter_start_date: string | null;
  pipeline_stage: { name: string } | null;
}

export default async function RevenuePage() {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);

  // Fetch all contacts with charter data in parallel
  const [closedWonRes, pendingRes, pipelineRes, allDealsRes] =
    await Promise.all([
      // Sum commission_earned for Closed Won
      supabase
        .from("contacts")
        .select(
          "commission_earned, pipeline_stage:pipeline_stages!inner(name)"
        )
        .eq("pipeline_stages.name", "Closed Won"),

      // Count pending payments
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("payment_status", "pending"),

      // Sum charter_fee for pipeline stages: Hot, Meeting, Proposal
      supabase
        .from("contacts")
        .select(
          "charter_fee, pipeline_stage:pipeline_stages!inner(name)"
        )
        .in("pipeline_stages.name", ["Hot", "Meeting", "Proposal"]),

      // All deals with charter data for the list
      supabase
        .from("contacts")
        .select(
          "id, first_name, last_name, charter_vessel, charter_fee, commission_earned, commission_rate, payment_status, charter_start_date, pipeline_stage:pipeline_stages(name)"
        )
        .not("charter_fee", "is", null)
        .order("charter_start_date", { ascending: false }),
    ]);

  // Calculate season revenue
  const seasonRevenue = (closedWonRes.data ?? []).reduce(
    (sum, row) => sum + (row.commission_earned ?? 0),
    0
  );

  // Pending count
  const pendingPayments = pendingRes.count ?? 0;

  // Pipeline value
  const pipelineValue = (pipelineRes.data ?? []).reduce(
    (sum, row) => sum + (row.charter_fee ?? 0),
    0
  );

  // Build deals list
  const deals: DealRow[] = (allDealsRes.data ?? []).map((row) => {
    const stageData = row.pipeline_stage as unknown as
      | { name: string }
      | { name: string }[]
      | null;
    const stage = Array.isArray(stageData)
      ? stageData[0] ?? null
      : stageData;
    return {
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      charter_vessel: row.charter_vessel,
      charter_fee: row.charter_fee,
      commission_earned: row.commission_earned,
      commission_rate: row.commission_rate,
      payment_status: row.payment_status,
      charter_start_date: row.charter_start_date,
      pipeline_stage: stage,
    };
  });

  return (
    <RevenueClient
      seasonRevenue={seasonRevenue}
      pendingPayments={pendingPayments}
      pipelineValue={pipelineValue}
      deals={deals}
    />
  );
}
