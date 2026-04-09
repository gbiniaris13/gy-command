import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * GET — One-time seed: find or create Tricia as a Closed Won contact.
 */
export async function GET() {
  try {
    const supabase = createServiceClient();

    // Find "Closed Won" stage
    const { data: closedWonStage } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("name", "Closed Won")
      .single();

    if (!closedWonStage) {
      return NextResponse.json(
        { error: "Closed Won pipeline stage not found" },
        { status: 500 }
      );
    }

    // Check if Tricia already exists
    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .eq("first_name", "Tricia")
      .eq("source", "referral")
      .single();

    if (existing) {
      // Update existing contact to ensure correct stage and charter info
      await supabase
        .from("contacts")
        .update({
          pipeline_stage_id: closedWonStage.id,
          charter_vessel: "M/Y Effie Star",
          charter_notes: "First deal for George Yachts",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      return NextResponse.json({
        message: "Tricia already exists, updated to Closed Won",
        contactId: existing.id,
      });
    }

    // Create Tricia
    const { data: newContact, error } = await supabase
      .from("contacts")
      .insert({
        first_name: "Tricia",
        source: "referral",
        pipeline_stage_id: closedWonStage.id,
        charter_vessel: "M/Y Effie Star",
        charter_notes: "First deal for George Yachts",
        last_activity_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log activity
    await supabase.from("activities").insert({
      contact_id: newContact.id,
      type: "note",
      description: "Contact created via seed-tricia endpoint",
      metadata: { seeded: true },
    });

    return NextResponse.json({
      message: "Tricia created successfully",
      contactId: newContact.id,
    });
  } catch (err) {
    console.error("[Seed Tricia] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
