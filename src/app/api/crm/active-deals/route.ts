// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET() {
  const sb = createServiceClient();

  // Get contacts in active deal stages (Meeting Booked, Proposal Sent, Closed Won with charter data)
  const { data: stages } = await sb
    .from("pipeline_stages")
    .select("id, name")
    .in("name", ["Meeting Booked", "Proposal Sent", "Closed Won", "Hot"]);

  const stageIds = (stages ?? []).map((s) => s.id);
  if (stageIds.length === 0) return NextResponse.json({ deals: [] });

  const { data: contacts } = await sb
    .from("contacts")
    .select("id, first_name, last_name, company, charter_vessel, charter_start_date, charter_end_date, charter_fee, payment_status, last_activity_at, pipeline_stage_id")
    .in("pipeline_stage_id", stageIds)
    .order("charter_start_date", { ascending: true })
    .limit(10);

  const now = Date.now();
  const deals = (contacts ?? []).map((c) => {
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed";
    const daysUntil = c.charter_start_date
      ? Math.ceil((new Date(c.charter_start_date).getTime() - now) / 86400000)
      : null;
    return {
      id: c.id,
      name,
      company: c.company,
      vessel: c.charter_vessel,
      charter_start: c.charter_start_date,
      charter_end: c.charter_end_date,
      charter_fee: c.charter_fee ? `\u20AC${Number(c.charter_fee).toLocaleString()}` : null,
      payment_status: c.payment_status ?? "pending",
      last_activity_at: c.last_activity_at,
      days_until_charter: daysUntil,
    };
  });

  return NextResponse.json({ deals });
}
