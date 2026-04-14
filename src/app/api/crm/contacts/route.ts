import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// POST — Create a new contact
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("contacts")
      .insert({
        first_name: body.first_name || null,
        last_name: body.last_name || null,
        email: body.email || null,
        phone: body.phone || null,
        company: body.company || null,
        country: body.country || null,
        city: body.city || null,
        linkedin_url: body.linkedin_url || null,
        source: body.source || "manual",
        contact_type: body.contact_type || "OUTREACH_LEAD",
        pipeline_stage_id: body.pipeline_stage_id || null,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Log lead_captured activity
    await supabase.from("activities").insert({
      contact_id: data.id,
      type: "lead_captured",
      description: `Contact created: ${data.first_name ?? ""} ${data.last_name ?? ""}`.trim(),
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// PATCH — Update a contact
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = createServiceClient();

    if (!body.id) {
      return NextResponse.json({ error: "Contact ID required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    const allowed = [
      "first_name", "last_name", "email", "phone", "company",
      "country", "city", "linkedin_url", "source", "contact_type",
      "pipeline_stage_id", "yachts_viewed", "time_on_site", "notes",
      "nationality", "religion", "contract_signing_date", "after_sales_stage",
    ];

    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("contacts")
      .update(updates)
      .eq("id", body.id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
