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
    if (!contact) {
      return NextResponse.json(
        { error: "Dominic not found — no contact with email dmt@benarrivati.com" },
        { status: 404 },
      );
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

    // Append to charter_notes
    const appendNote = [
      "",
      "[Apr 16, 2026] Phone number captured: +1 561 765 6476",
      "(Florida — Palm Beach County area code 561). Confirms US presence;",
      "Italy operation runs through partner Andreas (Glyfada, Athens).",
      "",
      "Dual-market advantage for future coordination:",
      "- Dominic handles US clients",
      "- Andreas handles Italy/Europe",
      "- George handles Greek charter delivery",
      "",
      "Status: Awaiting availability for 3-way call (George + Dominic + Andreas)",
      "as proposed in Apr 15 follow-up email.",
    ].join("\n");

    const existingNotes = contact.charter_notes ?? "";
    const updatedNotes = existingNotes + appendNote;

    // Update contact
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

    // Add activity
    await supabase.from("activities").insert({
      contact_id: contact.id,
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
      contactId: contact.id,
      phone: "+1 561 765 6476",
      pipeline_stage: "Proposal Sent",
      notes_appended: true,
    });
  } catch (err) {
    console.error("[update-dominic] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
