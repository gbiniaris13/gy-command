import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// PATCH — Update a contact's pipeline stage (used by Kanban drag-drop)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const supabase = createServiceClient();

    if (!body.pipeline_stage_id) {
      return NextResponse.json(
        { error: "pipeline_stage_id required" },
        { status: 400 }
      );
    }

    // Get old stage name for logging
    const { data: contact } = await supabase
      .from("contacts")
      .select("pipeline_stage_id, first_name, last_name, pipeline_stage:pipeline_stages(name)")
      .eq("id", id)
      .single();

    // Get new stage name
    const { data: newStage } = await supabase
      .from("pipeline_stages")
      .select("name")
      .eq("id", body.pipeline_stage_id)
      .single();

    // Update the contact
    const { data, error } = await supabase
      .from("contacts")
      .update({
        pipeline_stage_id: body.pipeline_stage_id,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Log stage change activity
    const oldName = (contact?.pipeline_stage as { name?: string } | null)?.name ?? "Unknown";
    const newName = newStage?.name ?? "Unknown";

    await supabase.from("activities").insert({
      contact_id: id,
      type: "stage_change",
      description: `Stage changed from "${oldName}" to "${newName}"`,
      metadata: {
        from_stage: contact?.pipeline_stage_id,
        to_stage: body.pipeline_stage_id,
        from_name: oldName,
        to_name: newName,
      },
    });

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
