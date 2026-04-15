import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * GET — One-shot idempotent seed for Helen Skourti (Fraser Yachts Athens).
 *
 * Popy Kaia (Charter Director Greece, Fraser) assigned Helen to handle the
 * Smaragda Fetsi 50m+ / July–August / 10 Guests inquiry on 15 Apr 2026.
 * Added as a CENTRAL_AGENT in the Warm pipeline stage — actively engaged,
 * awaiting response with Fraser fleet options.
 *
 * Safe to call multiple times — upserts on email.
 */
export async function GET() {
  try {
    const supabase = createServiceClient();

    const { data: warmStage, error: stageErr } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("name", "Warm")
      .single();

    if (stageErr || !warmStage) {
      return NextResponse.json(
        { error: `Warm stage not found: ${stageErr?.message ?? "unknown"}` },
        { status: 500 }
      );
    }

    const nowIso = new Date().toISOString();

    const contactFields = {
      first_name: "Helen",
      last_name: "Skourti",
      email: "Helen.Skourti@fraseryachts.com",
      phone: "+30 21 1198 7600",
      company: "Fraser Yachts",
      country: "Greece",
      city: "Athens",
      source: "referral" as const,
      contact_type: "CENTRAL_AGENT" as const,
      pipeline_stage_id: warmStage.id,
      charter_notes: [
        "Role: Charter at Fraser Yachts, Athens office.",
        "Office: +30 21 1198 7600.",
        "Address: 8 Megalou Alexandrou, Glyfada, Athens.",
        "",
        "Assigned 15 Apr 2026 by Popy Kaia (Charter Director Greece, Fraser)",
        "to handle the 50m+ / July–August / 10 Guests inquiry",
        "(Ref: Smaragda Fetsi).",
        "",
        "Status: awaiting response with Fraser fleet options.",
      ].join("\n"),
      last_activity_at: nowIso,
      updated_at: nowIso,
    };

    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .eq("email", contactFields.email)
      .maybeSingle();

    let contactId: string;
    let created = false;

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from("contacts")
        .update(contactFields)
        .eq("id", existing.id);
      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
      contactId = existing.id;
    } else {
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

      await supabase.from("activities").insert({
        contact_id: contactId,
        type: "lead_captured",
        description:
          "Contact created: Helen Skourti (Fraser Yachts Athens) — assigned by Popy Kaia to handle 50m+ inquiry",
        metadata: { source: "seed-helen", seeded: true },
      });
    }

    await supabase.from("activities").insert({
      contact_id: contactId,
      type: "note",
      description:
        "Assigned by Popy Kaia (Charter Director Greece, Fraser) to handle Smaragda Fetsi 50m+ / July–August / 10 Guests inquiry. Awaiting Fraser fleet options.",
      metadata: {
        action: "assignment_received",
        assigned_by: "Popy Kaia",
        assigned_by_email: "popy.kaia@fraseryachts.com",
        assigned_at: "2026-04-15T11:08:23Z",
        reference: "Smaragda Fetsi — 50m+ inquiry",
        thread_subject:
          "Re: Charter Inquiry — 50m+ Motor Yacht | July–August | 10 Guests",
      },
    });

    return NextResponse.json({
      ok: true,
      created,
      contactId,
      contact_type: "CENTRAL_AGENT",
      stage: "Warm",
      company: "Fraser Yachts",
      email: contactFields.email,
    });
  } catch (err) {
    console.error("[seed-helen] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
