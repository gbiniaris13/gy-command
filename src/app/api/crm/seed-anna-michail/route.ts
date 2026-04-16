import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * GET — Idempotent seed for Anna Michail (IYC Charter Manager).
 *
 * She offered M/Y JO I and M/Y ZIA for Summer 2026 Greek charter.
 * CENTRAL_AGENT — IYC identity NEVER appears in client-facing materials.
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
        { error: `Warm stage not found: ${stageErr?.message}` },
        { status: 500 },
      );
    }

    const nowIso = new Date().toISOString();

    const contactFields = {
      first_name: "Anna",
      last_name: "Michail",
      email: "amichail@iyc.com",
      phone: "+30 698 665 6867",
      company: "IYC (International Yacht Company)",
      country: "Greece",
      city: "Athens",
      source: "referral" as const,
      contact_type: "CENTRAL_AGENT" as const,
      pipeline_stage_id: warmStage.id,
      charter_notes: [
        "CENTRAL AGENT CONTACT — IYC (International Yacht Company)",
        "",
        "Role: Charter Manager",
        "Office: +30 210 983 4382 · Mobile: +30 698 665 6867",
        "Address: 34 Alimou Avenue, Athens, 174 55, Greece",
        "",
        "First contact: Apr 15, 2026 (responded same day to George's availability request)",
        "Response speed: Fast (within business hours)",
        "Tone: Professional, warm, commercial",
        "",
        "Vessels offered for Summer 2026:",
        "1. M/Y JO I — 50m Benetti (2004/Refit 2022), 12 guests, 6 cabins",
        "   Available: 10–17 July Athens-Athens; from 28 July onwards",
        "   Rate: €199K/wk (peak) / €179K/wk (shoulder) + 35% APA + 5.2% VAT",
        "",
        "2. M/Y ZIA — 50m Ortona Navi (2008/Refit 2025), 12 guests, 6 cabins",
        "   Available: 3–10 July Athens-Athens; from 27 August onwards",
        "   Rate: €248K/wk (peak) / €220K (Jun/Sep) / €195K (other) + 35% APA + 5.2% VAT",
        "",
        "Commission terms: Standard market commission (confirm exact % on first deal)",
        "",
        "WHITE-LABEL RULE: IYC and Anna's name NEVER appear in any",
        "client-facing materials. These vessels are 'from our fleet network.'",
        "Central agent identity is confidential.",
        "",
        "Strategic value: IYC is one of the largest central agents globally.",
        "This is a relationship to nurture — fast responses + premium fleet access.",
        "",
        "Next steps:",
        "- Keep as warm supplier contact",
        "- When a client matches JO I / ZIA profile (family group, 12 guests,",
        "  €150K+/week budget, July-August Greece), Anna is our first call",
      ].join("\n"),
      last_activity_at: nowIso,
      updated_at: nowIso,
    };

    // Upsert by email
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
          { status: 500 },
        );
      }
      contactId = newContact.id;
      created = true;

      await supabase.from("activities").insert({
        contact_id: contactId,
        type: "lead_captured",
        description:
          "Contact created: Anna Michail (IYC Charter Manager) — offered M/Y JO I + M/Y ZIA for Summer 2026",
        metadata: { source: "seed-anna-michail", seeded: true },
      });
    }

    // Log vessel offers as activities
    await supabase.from("activities").insert([
      {
        contact_id: contactId,
        type: "note",
        description:
          "Offered M/Y JO I (50m Benetti, 2004/Refit 2022) · 12 guests · €199K/wk peak · Jul 10–17 + Jul 28 onwards · Athens-Athens",
        metadata: {
          action: "vessel_offered",
          vessel: "M/Y JO I",
          builder: "Benetti",
          year: 2004,
          refit: 2022,
          length_m: 50,
          guests: 12,
          cabins: 6,
          rate_peak_eur: 199000,
          rate_shoulder_eur: 179000,
          apa_pct: 35,
          vat_pct: 5.2,
        },
      },
      {
        contact_id: contactId,
        type: "note",
        description:
          "Offered M/Y ZIA (50m Ortona Navi, 2008/Refit 2025) · 12 guests · €248K/wk peak · Jul 3–10 + Aug 27 onwards · Athens-Athens",
        metadata: {
          action: "vessel_offered",
          vessel: "M/Y ZIA",
          builder: "Ortona Navi",
          year: 2008,
          refit: 2025,
          length_m: 50,
          guests: 12,
          cabins: 6,
          rate_peak_eur: 248000,
          rate_shoulder_high_eur: 220000,
          rate_shoulder_low_eur: 195000,
          apa_pct: 35,
          vat_pct: 5.2,
        },
      },
    ]);

    return NextResponse.json({
      ok: true,
      created,
      contactId,
      contact_type: "CENTRAL_AGENT",
      stage: "Warm",
      offers: [
        "M/Y JO I — 50m Benetti — €199K/wk peak",
        "M/Y ZIA — 50m Ortona Navi — €248K/wk peak",
      ],
    });
  } catch (err) {
    console.error("[seed-anna-michail] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
