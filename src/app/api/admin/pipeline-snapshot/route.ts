// /api/admin/pipeline-snapshot — read-only snapshot of the CRM pipeline
// for boardroom strategy sessions. Aggregates 5 views in one call:
//
//   1. Contacts grouped by pipeline_stage
//   2. Active deals (contacts with charter_fee > 0) sorted desc
//   3. Pending payments (charter_fee > 0 AND payment_status = 'pending')
//   4. Stale warm leads (in active stages, no activity 7+ days)
//   5. Source breakdown for the active pipeline
//
// Schema notes (as of 2026-04-25):
//   - There is NO separate `deals` table — deal fields are denormalized
//     into `contacts` (charter_fee, commission_earned, charter_vessel,
//     charter_start_date, payment_status). The "deals" abstraction
//     lives in dashboard logic, not the DB.
//   - pipeline_stage is a FK (pipeline_stage_id → pipeline_stages.id),
//     so we resolve to the human-readable name via inner join.
//   - Activities link by contact_id, not contact_email.
//
// Read-only. No mutations. Safe to call from chat/cron/CLI.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACTIVE_STAGE_NAMES = [
  "Warm",
  "Hot",
  "Negotiation",
  "Proposal Sent",
  "Meeting Booked",
  "Contract Sent",
];

const TERMINAL_OR_NEW = ["Lost", "Won", "Closed Won", "Closed Lost", "New", "New Lead"];

export async function GET() {
  const sb = createServiceClient();
  const out: any = { generated_at: new Date().toISOString() };

  // ─── 1. Contacts per pipeline_stage ───────────────────────────────
  const { data: stageRows, error: e1 } = await sb
    .from("contacts")
    .select("pipeline_stage:pipeline_stages(name), id")
    .limit(20000);
  if (e1) out.errors_1 = e1.message;
  const stageCounts: Record<string, number> = {};
  for (const r of stageRows ?? []) {
    const stage =
      Array.isArray((r as any).pipeline_stage)
        ? ((r as any).pipeline_stage[0]?.name ?? "Unknown")
        : ((r as any).pipeline_stage?.name ?? "Unknown");
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
  }
  out.contacts_by_stage = Object.entries(stageCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([stage, count]) => ({ stage, count }));
  out.total_contacts = (stageRows ?? []).length;

  // ─── 2. Active deals (charter_fee > 0) ─────────────────────────────
  const { data: deals, error: e2 } = await sb
    .from("contacts")
    .select(
      "first_name, last_name, email, charter_vessel, charter_start_date, charter_end_date, charter_fee, commission_earned, commission_rate, payment_status, pipeline_stage:pipeline_stages(name)",
    )
    .gt("charter_fee", 0)
    .order("charter_fee", { ascending: false });
  if (e2) out.errors_2 = e2.message;
  out.deals = (deals ?? []).map((d: any) => ({
    name: [d.first_name, d.last_name].filter(Boolean).join(" ") || "—",
    email: d.email,
    vessel: d.charter_vessel,
    start_date: d.charter_start_date,
    end_date: d.charter_end_date,
    charter_fee: d.charter_fee,
    commission_earned: d.commission_earned,
    commission_rate: d.commission_rate,
    payment_status: d.payment_status,
    stage: Array.isArray(d.pipeline_stage)
      ? (d.pipeline_stage[0]?.name ?? null)
      : (d.pipeline_stage?.name ?? null),
  }));
  out.pipeline_value_eur = (deals ?? []).reduce(
    (sum: number, d: any) => sum + (Number(d.charter_fee) || 0),
    0,
  );
  out.commission_upside_eur = (deals ?? []).reduce(
    (sum: number, d: any) => sum + (Number(d.commission_earned) || 0),
    0,
  );

  // ─── 3. Pending payments ───────────────────────────────────────────
  out.pending_payments = (deals ?? [])
    .filter((d: any) => (d.payment_status ?? "").toLowerCase() === "pending")
    .map((d: any) => ({
      name: [d.first_name, d.last_name].filter(Boolean).join(" ") || "—",
      email: d.email,
      vessel: d.charter_vessel,
      start_date: d.charter_start_date,
      charter_fee: d.charter_fee,
    }));
  out.pending_payments_total_eur = out.pending_payments.reduce(
    (sum: number, d: any) => sum + (Number(d.charter_fee) || 0),
    0,
  );

  // ─── 4. Stale warm leads (active stage, no activity 7+ days) ──────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { data: stageList } = await sb
    .from("pipeline_stages")
    .select("id, name");
  const activeStageIds = (stageList ?? [])
    .filter((s: any) => ACTIVE_STAGE_NAMES.includes(s.name))
    .map((s: any) => s.id);

  const { data: activeContacts, error: e4 } = await sb
    .from("contacts")
    .select(
      "id, first_name, last_name, email, last_activity_at, pipeline_stage:pipeline_stages(name)",
    )
    .in("pipeline_stage_id", activeStageIds)
    .limit(1000);
  if (e4) out.errors_4 = e4.message;

  const stale = (activeContacts ?? [])
    .map((c: any) => {
      const last = c.last_activity_at ? new Date(c.last_activity_at) : null;
      if (!last) return null;
      const days = Math.floor(
        (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (days < 7) return null;
      return {
        name:
          [c.first_name, c.last_name].filter(Boolean).join(" ") || "—",
        email: c.email,
        stage: Array.isArray(c.pipeline_stage)
          ? c.pipeline_stage[0]?.name
          : c.pipeline_stage?.name,
        last_activity: c.last_activity_at,
        days_stale: days,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.days_stale - a.days_stale);
  out.stale_warm_leads = stale.slice(0, 20);

  // ─── 5. Source breakdown for active pipeline ──────────────────────
  // We need contacts in non-terminal stages, grouped by source × stage.
  const terminalIds = (stageList ?? [])
    .filter((s: any) => TERMINAL_OR_NEW.includes(s.name))
    .map((s: any) => s.id);
  const { data: sourceContacts, error: e5 } = await sb
    .from("contacts")
    .select("source, pipeline_stage:pipeline_stages(name), pipeline_stage_id")
    .not("pipeline_stage_id", "in", `(${terminalIds.join(",") || "0"})`)
    .limit(10000);
  if (e5) out.errors_5 = e5.message;

  const sourceMap: Record<string, Record<string, number>> = {};
  for (const c of sourceContacts ?? []) {
    const src = (c as any).source || "unknown";
    const stage =
      Array.isArray((c as any).pipeline_stage)
        ? (c as any).pipeline_stage[0]?.name ?? "Unknown"
        : (c as any).pipeline_stage?.name ?? "Unknown";
    sourceMap[src] = sourceMap[src] || {};
    sourceMap[src][stage] = (sourceMap[src][stage] ?? 0) + 1;
  }
  out.source_breakdown = Object.entries(sourceMap)
    .map(([source, stages]) => ({
      source,
      stages,
      total: Object.values(stages).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json(out);
}
