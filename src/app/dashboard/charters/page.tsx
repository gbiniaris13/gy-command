// v3 Pillar 7+8 — Charters index.
//
// Phase 3.2 (2026-04-30) — converts the flat deals table into a 3-tab
// dashboard (Pipeline / Active / Post-charter) following the
// Newsletter pattern. Server fetches, client owns tab UX.

import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import ChartersClient from "./ChartersClient";

export const dynamic = "force-dynamic";

interface DealRow {
  id: string;
  vessel_name: string | null;
  charter_start_date: string | null;
  charter_end_date: string | null;
  guest_count: number | null;
  charter_fee_eur: number | null;
  payment_status: string | null;
  lifecycle_status: string | null;
  primary_contact_id: string | null;
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export default async function ChartersIndexPage() {
  const cookieStore = await cookies();
  const sb = createServerSupabaseClient(cookieStore);

  const { data: deals } = await sb
    .from("deals")
    .select(
      "id, vessel_name, charter_start_date, charter_end_date, guest_count, charter_fee_eur, payment_status, lifecycle_status, primary_contact_id",
    )
    .order("charter_start_date", { ascending: true })
    .limit(500);

  const dealList = (deals ?? []) as DealRow[];

  const contactIds = Array.from(
    new Set(dealList.map((d) => d.primary_contact_id).filter(Boolean)),
  ) as string[];

  const contactsById: Record<string, ContactRow> = {};
  if (contactIds.length) {
    const { data: contacts } = await sb
      .from("contacts")
      .select("id, first_name, last_name, email")
      .in("id", contactIds);
    for (const c of (contacts ?? []) as ContactRow[]) {
      contactsById[c.id] = c;
    }
  }

  const { count: reviewCount } = await sb
    .from("charter_documents")
    .select("id", { count: "exact", head: true })
    .eq("extraction_status", "manual_review");

  return (
    <ChartersClient
      deals={dealList}
      contactsById={contactsById}
      reviewCount={reviewCount ?? 0}
    />
  );
}
