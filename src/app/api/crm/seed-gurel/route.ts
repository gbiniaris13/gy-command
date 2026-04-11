import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * GET — One-shot idempotent seed for the Gürel / VOYAGE BY AXİOM deal.
 *
 * Creates (or updates) Halilcan Gürel as a contact in the "Proposal Sent"
 * pipeline stage with the full La Pellegrina 1 charter deal attached.
 * Safe to call multiple times — will upsert into the same row keyed on email.
 */
export async function GET() {
  try {
    const supabase = createServiceClient();

    // 1. Find the Proposal Sent pipeline stage
    const { data: proposalStage, error: stageErr } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("name", "Proposal Sent")
      .single();

    if (stageErr || !proposalStage) {
      return NextResponse.json(
        { error: `Proposal Sent stage not found: ${stageErr?.message ?? "unknown"}` },
        { status: 500 }
      );
    }

    const nowIso = new Date().toISOString();

    const contactFields = {
      first_name: "Halilcan",
      last_name: "Gürel",
      email: "halilcangurell@gmail.com",
      company: "VOYAGE BY AXİOM",
      country: "Turkey",
      city: "Istanbul",
      linkedin_url: "https://www.linkedin.com/in/halilcangürel",
      source: "linkedin_inbound",
      pipeline_stage_id: proposalStage.id,
      // Charter / deal fields
      charter_vessel: "M/Y La Pellegrina 1 (Couach 50m)",
      charter_start_date: "2026-07-19",
      charter_end_date: "2026-07-26",
      charter_guests: 10,
      charter_embarkation: "Athens",
      charter_disembarkation: "Athens",
      charter_fee: 235000,
      commission_rate: 15,
      commission_earned: 35250,
      payment_status: "pending",
      charter_notes: [
        "Broker-to-broker deal (George Yachts as introducing broker).",
        "Central agent: Istion — Eva Tsiota.",
        "Proposal sent 10 April 2026 15:00 for M/Y La Pellegrina 1 (Couach 50m).",
        "Dates: 19-26 July 2026, Athens-Athens, 10 guests.",
        "Rate: €235,000 charter fee · 15% commission = €35,250.",
        "Next step: awaiting client feedback + additional options from EKKA, Fraser, IYC, C&N early next week.",
      ].join("\n"),
      last_activity_at: nowIso,
      updated_at: nowIso,
    };

    // 2. Check if contact already exists by email (idempotent)
    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .eq("email", contactFields.email)
      .maybeSingle();

    let contactId: string;
    let created = false;

    if (existing?.id) {
      // Update existing
      const { error: updErr } = await supabase
        .from("contacts")
        .update(contactFields)
        .eq("id", existing.id);
      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
      contactId = existing.id;
    } else {
      // Create new
      const { data: newContact, error: insErr } = await supabase
        .from("contacts")
        .insert(contactFields)
        .select("id")
        .single();
      if (insErr || !newContact) {
        return NextResponse.json(
          { error: insErr?.message ?? "insert failed" },
          { status: 500 }
        );
      }
      contactId = newContact.id;
      created = true;

      // Log lead_captured activity only on first create
      await supabase.from("activities").insert({
        contact_id: contactId,
        type: "lead_captured",
        description: "Contact created: Halilcan Gürel (VOYAGE BY AXİOM) — LinkedIn inbound",
        metadata: { source: "seed-gurel", seeded: true },
      });
    }

    // 3. Log proposal_sent activity
    await supabase.from("activities").insert({
      contact_id: contactId,
      type: "note",
      description:
        "Proposal sent for M/Y La Pellegrina 1 · 19-26 Jul 2026 · Athens-Athens · €235,000 · 15% = €35,250",
      metadata: {
        action: "proposal_sent",
        vessel: "M/Y La Pellegrina 1",
        charter_fee: 235000,
        commission_earned: 35250,
        central_agent: "Istion — Eva Tsiota",
        sent_at: "2026-04-10T15:00:00Z",
      },
    });

    return NextResponse.json({
      ok: true,
      created,
      contactId,
      stage: "Proposal Sent",
      deal: "Gürel / VOYAGE BY AXİOM — M/Y La Pellegrina 1",
      charter_fee: 235000,
      commission_earned: 35250,
    });
  } catch (err) {
    console.error("[Seed Gürel] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
