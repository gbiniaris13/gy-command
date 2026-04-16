import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * GET — Idempotent update for Dominic (Benarrivati).
 *
 * Adds phone number, upgrades pipeline to "Proposal Sent", appends
 * charter notes and activity. Safe to call multiple times.
 */
export async function GET() {
  try {
    const supabase = createServiceClient();

    // Find Dominic by email
    const { data: contact, error: findErr } = await supabase
      .from("contacts")
      .select("id, phone, charter_notes, pipeline_stage_id")
      .eq("email", "dmt@benarrivati.com")
      .maybeSingle();

    if (findErr) {
      return NextResponse.json({ error: findErr.message }, { status: 500 });
    }
    // Resolve "Proposal Sent" stage
    const { data: proposalStage, error: stageErr } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("name", "Proposal Sent")
      .single();

    if (stageErr || !proposalStage) {
      return NextResponse.json(
        { error: `Proposal Sent stage not found: ${stageErr?.message}` },
        { status: 500 },
      );
    }

    const nowIso = new Date().toISOString();

    const charterNotes = [
      "B2B PARTNERSHIP — Benarrivati Luxury Travel Services",
      "",
      "Contact: Dominic (Founder/CEO)",
      "Email: dmt@benarrivati.com",
      "Phone: +1 561 765 6476 (Florida — Palm Beach County area code 561)",
      "Company: Benarrivati Luxury Travel Services (USA + Italy)",
      "",
      "First contact: Apr 15, 2026 (28-min call — warm, collaborative tone)",
      "Partner Andreas based in Glyfada, Athens — handles Italy/Europe ops.",
      "",
      "Dual-market advantage for future coordination:",
      "- Dominic handles US clients",
      "- Andreas handles Italy/Europe",
      "- George handles Greek charter delivery",
      "",
      "Partnership PDF + GY policy breakdown both sent Apr 15.",
      "Status: Awaiting availability for 3-way call (George + Dominic + Andreas)",
      "as proposed in Apr 15 follow-up email.",
    ].join("\n");

    let contactId: string;
    let created = false;

    if (contact) {
      // Update existing
      const appendNote = [
        "",
        "[Apr 16, 2026] Phone number captured: +1 561 765 6476",
        "(Florida — Palm Beach County area code 561). Confirms US presence.",
        "Pipeline upgraded to Proposal Sent.",
      ].join("\n");

      const updatedNotes = (contact.charter_notes ?? "") + appendNote;

      const { error: updErr } = await supabase
        .from("contacts")
        .update({
          phone: "+1 561 765 6476",
          pipeline_stage_id: proposalStage.id,
          charter_notes: updatedNotes,
          last_activity_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", contact.id);

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
      contactId = contact.id;
    } else {
      // Create new
      const { data: newContact, error: insErr } = await supabase
        .from("contacts")
        .insert({
          first_name: "Dominic",
          last_name: "(Benarrivati)",
          email: "dmt@benarrivati.com",
          phone: "+1 561 765 6476",
          company: "Benarrivati Luxury Travel Services",
          country: "United States",
          city: "Palm Beach, FL",
          source: "referral" as const,
          contact_type: "B2B_PARTNER" as const,
          pipeline_stage_id: proposalStage.id,
          charter_notes: charterNotes,
          last_activity_at: nowIso,
          updated_at: nowIso,
        })
        .select("id")
        .single();

      if (insErr || !newContact) {
        return NextResponse.json(
          { error: insErr?.message ?? "insert failed" },
          { status: 500 },
        );
      }
      contactId = newContact.id;
      created = true;

      await supabase.from("activities").insert({
        contact_id: contactId,
        type: "lead_captured",
        description:
          "Contact created: Dominic (Benarrivati) — B2B partnership lead, USA + Italy. 28-min call completed Apr 15.",
        metadata: { source: "seed-dominic", seeded: true },
      });
    }

    // Add phone capture activity
    await supabase.from("activities").insert({
      contact_id: contactId,
      type: "note",
      description:
        "Phone captured: +1 561 765 6476 (Florida / Palm Beach County area code 561). Pipeline upgraded to Proposal Sent — partnership PDF + policy breakdown both sent.",
      metadata: {
        action: "phone_captured",
        phone: "+15617656476",
        region: "Florida — Palm Beach / Boca Raton",
        source: "update-dominic",
      },
    });

    return NextResponse.json({
      ok: true,
      created,
      contactId,
      contact_type: created ? "B2B_PARTNER" : "updated",
      phone: "+1 561 765 6476",
      pipeline_stage: "Proposal Sent",
    });
  } catch (err) {
    console.error("[update-dominic] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
