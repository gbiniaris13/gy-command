// v3 Pillar 7+8 — Charter activation cascade.
//
// When a contract is uploaded and successfully extracted, this fires:
//   1. Upsert the deal row with extracted fields
//   2. Mark contact as charter_client + linked to deal
//   3. Set lifecycle_status = 'active' + lifecycle_activated_at = now()
//   4. Plan and persist all 17 milestones from charter dates
//   5. Return summary for cockpit confirmation banner
//
// Called from /api/admin/charter-extract or the upload handler.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContractExtraction } from "@/lib/charter-doc-extractor";
import { planMilestones } from "@/lib/charter-lifecycle";

export interface ActivationResult {
  ok: boolean;
  deal_id: string | null;
  contact_id: string | null;
  milestones_generated: number;
  client_full_name: string | null;
  vessel_name: string | null;
  charter_start_date: string | null;
  charter_end_date: string | null;
  message: string;
}

export async function activateCharterFromContract(
  sb: SupabaseClient,
  args: {
    extracted: ContractExtraction;
    document_id: string;             // charter_documents.id of the contract
    primary_contact_id?: string | null;
  },
): Promise<ActivationResult> {
  const { extracted } = args;

  // 1. Resolve / create the primary contact.
  let contactId: string | null = args.primary_contact_id ?? null;
  if (!contactId && extracted.client_email) {
    const { data: existing } = await sb
      .from("contacts")
      .select("id")
      .ilike("email", extracted.client_email)
      .maybeSingle();
    if (existing?.id) {
      contactId = existing.id as string;
    } else {
      // Create the contact from contract data.
      const { data: stages } = await sb
        .from("pipeline_stages")
        .select("id, name");
      const stageMap = new Map<string, string>();
      for (const s of stages ?? [])
        stageMap.set(s.name as string, s.id as string);
      const closedWon = stageMap.get("Closed Won") ?? null;
      const [first, ...rest] = (extracted.client_full_name ?? "")
        .split(/\s+/)
        .filter(Boolean);
      const { data: inserted } = await sb
        .from("contacts")
        .insert({
          first_name: first ?? null,
          last_name: rest.join(" ") || null,
          email: extracted.client_email,
          phone: extracted.client_phone ?? null,
          country: extracted.client_country ?? null,
          source: "manual",
          contact_type: "DIRECT_CLIENT",
          pipeline_stage_id: closedWon,
          last_activity_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      contactId = (inserted?.id as string) ?? null;
    }
  }

  if (!contactId) {
    return {
      ok: false,
      deal_id: null,
      contact_id: null,
      milestones_generated: 0,
      client_full_name: extracted.client_full_name,
      vessel_name: extracted.vessel_name,
      charter_start_date: extracted.charter_start_date,
      charter_end_date: extracted.charter_end_date,
      message:
        "Cannot activate without a primary contact (no email in contract and none provided).",
    };
  }

  // 2. Upsert the deal. Match by primary_contact + start date to avoid
  //    duplicates if the same contract gets re-extracted.
  const dealPatch = {
    primary_contact_id: contactId,
    vessel_name: extracted.vessel_name,
    charter_start_date: extracted.charter_start_date,
    charter_end_date: extracted.charter_end_date,
    embark_port: extracted.embark_port,
    disembark_port: extracted.disembark_port,
    guest_count: extracted.guest_count,
    charter_fee_eur: extracted.charter_fee_eur,
    apa_eur: extracted.apa_eur,
    vat_rate: extracted.vat_rate,
    vat_eur: extracted.vat_eur,
    total_eur: extracted.total_eur,
    payment_status: "pending",
    contract_signed: true,
    client_country: extracted.client_country,
    client_residency: extracted.client_residency,
    lifecycle_status: "active",
    lifecycle_activated_at: new Date().toISOString(),
  };

  let dealId: string | null = null;
  {
    const { data: existing } = await sb
      .from("deals")
      .select("id")
      .eq("primary_contact_id", contactId)
      .eq("charter_start_date", extracted.charter_start_date as string)
      .maybeSingle();
    if (existing?.id) {
      dealId = existing.id as string;
      await sb.from("deals").update(dealPatch).eq("id", dealId);
    } else {
      const { data: inserted, error } = await sb
        .from("deals")
        .insert(dealPatch)
        .select("id")
        .single();
      if (error || !inserted) {
        return {
          ok: false,
          deal_id: null,
          contact_id: contactId,
          milestones_generated: 0,
          client_full_name: extracted.client_full_name,
          vessel_name: extracted.vessel_name,
          charter_start_date: extracted.charter_start_date,
          charter_end_date: extracted.charter_end_date,
          message: error?.message ?? "deal insert failed",
        };
      }
      dealId = inserted.id as string;
    }
  }

  // 3. Link the contract document to the deal.
  await sb
    .from("charter_documents")
    .update({ deal_id: dealId, contact_id: contactId })
    .eq("id", args.document_id);

  // 4. Mirror the deal onto the contact row (legacy denormalized fields
  //    that the rest of the cockpit reads from). Only mirror if the
  //    contact has no current deal or this is a more recent one.
  await sb
    .from("contacts")
    .update({
      charter_vessel: extracted.vessel_name,
      charter_start_date: extracted.charter_start_date,
      charter_end_date: extracted.charter_end_date,
      charter_fee: extracted.charter_fee_eur,
      charter_apa: extracted.apa_eur,
      contact_type: "DIRECT_CLIENT",
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", contactId);

  // 5. Plan and persist the 17 milestones.
  let milestonesGenerated = 0;
  if (extracted.charter_start_date && extracted.charter_end_date) {
    const plan = planMilestones({
      charter_start_date: extracted.charter_start_date,
      charter_end_date: extracted.charter_end_date,
    });
    const rows = plan.map((m) => ({
      deal_id: dealId,
      contact_id: contactId,
      milestone_type: m.milestone_type,
      due_date: m.due_date,
      auto_action: m.auto_action,
      status: "pending",
    }));
    // Use upsert with ON CONFLICT do nothing semantics via the unique
    // constraint (uq_milestone_per_deal_type) — re-running activation
    // doesn't dupe milestones.
    const { error } = await sb
      .from("charter_lifecycle_milestones")
      .upsert(rows, { onConflict: "deal_id,milestone_type" });
    if (!error) milestonesGenerated = rows.length;
  }

  return {
    ok: true,
    deal_id: dealId,
    contact_id: contactId,
    milestones_generated: milestonesGenerated,
    client_full_name: extracted.client_full_name,
    vessel_name: extracted.vessel_name,
    charter_start_date: extracted.charter_start_date,
    charter_end_date: extracted.charter_end_date,
    message: `Charter activated. ${milestonesGenerated} milestones generated.`,
  };
}
