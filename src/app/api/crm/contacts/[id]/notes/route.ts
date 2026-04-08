import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// POST — Add a note to a contact
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const supabase = createServiceClient();

    if (!body.content?.trim()) {
      return NextResponse.json(
        { error: "Note content required" },
        { status: 400 }
      );
    }

    // Insert note
    const { data, error } = await supabase
      .from("notes")
      .insert({
        contact_id: id,
        content: body.content.trim(),
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Log activity
    await supabase.from("activities").insert({
      contact_id: id,
      type: "note",
      description: body.content.trim().substring(0, 200),
    });

    // Update last_activity_at
    await supabase
      .from("contacts")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
