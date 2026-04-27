// v3 Pillar 8 — Per-deal charter document workspace.
//
// Server component that loads the deal + any uploaded documents, then
// hands them to <UploadClient/> for the interactive upload flow.

import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import UploadClient from "./UploadClient";

export const dynamic = "force-dynamic";

interface DealRow {
  id: string;
  primary_contact_id: string | null;
  vessel_name: string | null;
  charter_start_date: string | null;
  charter_end_date: string | null;
  embark_port: string | null;
  disembark_port: string | null;
  guest_count: number | null;
  charter_fee_eur: number | null;
  apa_eur: number | null;
  total_eur: number | null;
  payment_status: string | null;
  contract_signed: boolean | null;
  lifecycle_status: string | null;
  lifecycle_activated_at: string | null;
}

interface DocRow {
  id: string;
  document_type: string;
  original_filename: string | null;
  uploaded_at: string;
  extraction_status: string | null;
  extraction_confidence: number | null;
  extraction_errors: string | null;
}

interface MilestoneRow {
  id: string;
  milestone_type: string;
  due_date: string;
  status: string;
  auto_action: string | null;
}

export default async function CharterDealPage({
  params,
}: {
  params: Promise<{ deal_id: string }>;
}) {
  const { deal_id } = await params;
  const cookieStore = await cookies();
  const sb = createServerSupabaseClient(cookieStore);

  // The "new" sentinel renders the page with no deal yet — useful when
  // a contract is uploaded ahead of any deal record. Activation creates
  // the deal as part of the cascade.
  const isNew = deal_id === "new";

  let deal: DealRow | null = null;
  let documents: DocRow[] = [];
  let milestones: MilestoneRow[] = [];
  let primaryContactName: string | null = null;

  if (!isNew) {
    const { data: dealRow } = await sb
      .from("deals")
      .select("*")
      .eq("id", deal_id)
      .maybeSingle();
    deal = (dealRow ?? null) as DealRow | null;

    const { data: docs } = await sb
      .from("charter_documents")
      .select(
        "id, document_type, original_filename, uploaded_at, extraction_status, extraction_confidence, extraction_errors",
      )
      .eq("deal_id", deal_id)
      .order("uploaded_at", { ascending: false });
    documents = (docs ?? []) as DocRow[];

    const { data: ms } = await sb
      .from("charter_lifecycle_milestones")
      .select("id, milestone_type, due_date, status, auto_action")
      .eq("deal_id", deal_id)
      .order("due_date", { ascending: true });
    milestones = (ms ?? []) as MilestoneRow[];

    if (deal?.primary_contact_id) {
      const { data: c } = await sb
        .from("contacts")
        .select("first_name, last_name, email")
        .eq("id", deal.primary_contact_id)
        .maybeSingle();
      if (c) {
        const fn = (c.first_name as string | null) ?? "";
        const ln = (c.last_name as string | null) ?? "";
        primaryContactName =
          `${fn} ${ln}`.trim() || (c.email as string | null) || null;
      }
    }
  }

  return (
    <UploadClient
      dealId={isNew ? null : deal_id}
      deal={deal}
      documents={documents}
      milestones={milestones}
      primaryContactName={primaryContactName}
    />
  );
}
