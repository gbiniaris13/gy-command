import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * PATCH — Update charter fields for a contact.
 * Accepts any subset of charter-related fields.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const supabase = createServiceClient();

    // Build update object from allowed charter fields
    const allowedFields = [
      "charter_vessel",
      "charter_start_date",
      "charter_end_date",
      "charter_guests",
      "charter_embarkation",
      "charter_disembarkation",
      "charter_fee",
      "charter_apa",
      "captain_name",
      "captain_phone",
      "charter_notes",
      "payment_status",
    ] as const;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    // Reset post_charter_step if end date changes
    if ("charter_end_date" in body) {
      updates.post_charter_step = 0;
    }

    const { data, error } = await supabase
      .from("contacts")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Log activity
    const changedFields = Object.keys(updates).filter(
      (k) => k !== "updated_at" && k !== "post_charter_step"
    );
    if (changedFields.length > 0) {
      await supabase.from("activities").insert({
        contact_id: id,
        type: "note",
        description: `Charter details updated: ${changedFields.join(", ")}`,
        metadata: updates,
      });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
