import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * PATCH — Update charter_end_date for a contact and reset post_charter_step.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const supabase = createServiceClient();

    const charterEndDate = body.charter_end_date ?? null;

    const { data, error } = await supabase
      .from("contacts")
      .update({
        charter_end_date: charterEndDate,
        post_charter_step: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Log activity
    if (charterEndDate) {
      await supabase.from("activities").insert({
        contact_id: id,
        type: "note",
        description: `Charter end date set to ${charterEndDate}`,
        metadata: { charter_end_date: charterEndDate },
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
