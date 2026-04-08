import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  try {
    const contactId = req.nextUrl.searchParams.get("contactId");

    const supabase = createServiceClient();

    let query = supabase
      .from("charter_reminders")
      .select("*")
      .order("reminder_date", { ascending: true });

    if (contactId) {
      query = query.eq("contact_id", contactId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ reminders: data });
  } catch (err) {
    console.error("[Charter Reminders GET] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, completed, snoozed_until } = body as {
      id: string;
      completed?: boolean;
      snoozed_until?: string | null;
    };

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const updates: Record<string, unknown> = {};
    if (typeof completed === "boolean") updates.completed = completed;
    if (snoozed_until !== undefined) updates.snoozed_until = snoozed_until;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("charter_reminders")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ reminder: data });
  } catch (err) {
    console.error("[Charter Reminders PATCH] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
