import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * GET — One-shot idempotent seed for Aliona Antoci (IYC Charter Manager).
 *
 * She replied to the 50m+ / July–August / 10 Guests inquiry (Smaragda Fetsi
 * reference) offering M/Y BLISS. Added as a CENTRAL_AGENT in the Warm
 * pipeline stage — the closest match for an actively engaged central agent.
 *
 * Safe to call multiple times — upserts on email.
 */
export async function GET() {
  try {
    const supabase = createServiceClient();

    // 1. Resolve the Warm pipeline stage
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
      first_name: "Aliona",
      last_name: "Antoci",
      email: "aantoci@iyc.com",
      phone: "+30 694 859 1860",
      company: "IYC",
      country: "Greece",
      city: "Athens",
      source: "referral" as const,
      contact_type: "CENTRAL_AGENT" as const,
      pipeline_stage_id: warmStage.id,
      charter_notes: [
        "Role: Charter Manager at IYC (aantoci@iyc.com).",
        "Office: +30 210 9834382 · Mobile: +30 694 859 1860.",
        "Address: 34 Alimou Avenue, Athens 174 55, Greece.",
        "",
        "Responded 14 Apr 2026 to the 50m+ / July–August / 10 Guests inquiry",
        "(Ref: Smaragda Fetsi) offering M/Y BLISS.",
        "",
        "M/Y BLISS — 44m Heesen, 2007 (Refit 2025)",
        "· 12 guests in 7 cabins · cruising Greece · home port Athens.",
        "· New 7th cabin on upper deck, beach club, sauna, cold plunge, gym.",
        "· Technohull Explorer 40ft RIB (2×450 hp, 75 kn).",
        "· Chef with Michelin-star experience.",
        "· Max speed 25 kn.",
        "",
        "Available dates (Summer 2026):",
        "· 1–8 Jul — Athens / Athens",
        "· 9–16 Jul — Athens / Athens",
        "· 17–24 Jul — Athens / Kefalonia (no delivery fees)",
        "· 11 Aug onwards",
        "",
        "Rate: €195,000/week (Low) – €235,000/week (High) + 35% APA + 5.2% VAT.",
        "",
        "Thread CC: chartermanagement.greece@iyc.com.",
      ].join("\n"),
      last_activity_at: nowIso,
      updated_at: nowIso,
    };

    // 2. Upsert by email
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
          "Contact created: Aliona Antoci (IYC Charter Manager) — replied with M/Y BLISS offer",
        metadata: { source: "seed-aliona", seeded: true },
      });
    }

    // 3. Log the BLISS offer as a note
    await supabase.from("activities").insert({
      contact_id: contactId,
      type: "note",
      description:
        "Offered M/Y BLISS (44m Heesen, 2007/Refit 2025) for Smaragda Fetsi 50m+ inquiry · €195k–€235k/wk + 35% APA + 5.2% VAT · Jul 1–8 / 9–16 / 17–24 + Aug 11 onwards",
      metadata: {
        action: "vessel_offered",
        vessel: "M/Y BLISS",
        builder: "Heesen",
        year: 2007,
        refit: 2025,
        length_m: 44,
        guests: 12,
        cabins: 7,
        rate_low_eur: 195000,
        rate_high_eur: 235000,
        apa_pct: 35,
        vat_pct: 5.2,
        reference: "Smaragda Fetsi — 50m+ inquiry",
        thread_cc: "chartermanagement.greece@iyc.com",
      },
    });

    return NextResponse.json({
      ok: true,
      created,
      contactId,
      contact_type: "CENTRAL_AGENT",
      stage: "Warm",
      offer: "M/Y BLISS — 44m Heesen — €195k–€235k/wk",
    });
  } catch (err) {
    console.error("[seed-aliona] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
