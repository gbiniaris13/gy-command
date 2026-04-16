import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * GET — Idempotent seed for M/Y JO I and M/Y ZIA.
 *
 * Both offered by Anna Michail (IYC) for Summer 2026 Greek charter.
 * Central agent fields are INTERNAL ONLY — never client-facing.
 *
 * Creates the vessels table if it doesn't exist (runs migration SQL).
 * Upserts by vessel_name so safe to call multiple times.
 */
export async function GET() {
  try {
    const supabase = createServiceClient();

    // Ensure table exists — run CREATE TABLE IF NOT EXISTS via rpc or direct SQL
    // The table may already exist from migration; this is a safety net.
    await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS vessels (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          vessel_name text NOT NULL UNIQUE,
          length_meters numeric,
          builder text,
          year_built int,
          year_refit int,
          guest_capacity int,
          cabin_count int,
          crew_count int,
          home_port text,
          cruising_region text,
          central_agent text,
          central_agent_contact text,
          central_agent_contact_id uuid,
          rate_peak numeric,
          rate_shoulder numeric,
          rate_shoulder_high numeric,
          rate_shoulder_low numeric,
          vat_rate numeric DEFAULT 5.2,
          apa_rate numeric DEFAULT 35,
          brochure_url text,
          availability_2026 text,
          status text DEFAULT 'active_offering',
          tier text,
          features text,
          ideal_for text,
          notes text,
          date_added date DEFAULT CURRENT_DATE,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        );
      `,
    }).catch(() => {
      // exec_sql may not exist — table was likely created via Supabase SQL editor
    });

    // Find Anna's contact id for the FK
    const { data: anna } = await supabase
      .from("contacts")
      .select("id")
      .eq("email", "amichail@iyc.com")
      .maybeSingle();

    const joI = {
      vessel_name: "M/Y JO I",
      length_meters: 50,
      builder: "Benetti",
      year_built: 2004,
      year_refit: 2022,
      guest_capacity: 12,
      cabin_count: 6,
      crew_count: 11,
      home_port: "Athens, Greece",
      cruising_region: "Greece / East Med",
      central_agent: "IYC",
      central_agent_contact: "Anna Michail",
      central_agent_contact_id: anna?.id ?? null,
      rate_peak: 199000,
      rate_shoulder: 179000,
      vat_rate: 5.2,
      apa_rate: 35,
      brochure_url: "https://www.yachtfolio.com/e-brochure/JO_I/6dVlnq2s98CT",
      availability_2026: "10-17 July Athens-Athens; from 28 July onwards",
      status: "active_offering",
      tier: "premium",
      features:
        "Jacuzzi, beach club, waterslide, gym, cinema with projector + jukebox, stabilizers, extensive water toys, main-deck master + upper-deck VIP",
      ideal_for: "Families or groups of 12, multi-generational charters",
      date_added: "2026-04-15",
    };

    const zia = {
      vessel_name: "M/Y ZIA",
      length_meters: 50,
      builder: "Ortona Navi",
      year_built: 2008,
      year_refit: 2025,
      guest_capacity: 12,
      cabin_count: 6,
      crew_count: 12,
      home_port: "Athens, Greece",
      cruising_region: "Greece / East Med",
      central_agent: "IYC",
      central_agent_contact: "Anna Michail",
      central_agent_contact_id: anna?.id ?? null,
      rate_peak: 248000,
      rate_shoulder_high: 220000,
      rate_shoulder_low: 195000,
      vat_rate: 5.2,
      apa_rate: 35,
      brochure_url: "https://www.yachtfolio.com/e-brochure/ZIA/lozVIHyQBMQw",
      availability_2026: "3-10 July Athens-Athens; from 27 August onwards",
      status: "active_offering",
      tier: "premium_plus",
      features:
        "Extensive refit 2024+2025, master suite with his-and-hers bathroom + private Jacuzzi, stabilizers at anchor AND underway, 2022 Technohull Omega 47 chase boat, Starlink connectivity, waterslide, flexible cabin config (4 double + 2 twin convertible)",
      ideal_for:
        "Discerning groups prioritizing newest refit + tech connectivity",
      date_added: "2026-04-15",
    };

    const results: Array<{ vessel: string; created: boolean; id?: string; error?: string }> = [];

    for (const vessel of [joI, zia]) {
      // Check if exists
      const { data: existing } = await supabase
        .from("vessels")
        .select("id")
        .eq("vessel_name", vessel.vessel_name)
        .maybeSingle();

      if (existing?.id) {
        const { error: updErr } = await supabase
          .from("vessels")
          .update({ ...vessel, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        results.push({
          vessel: vessel.vessel_name,
          created: false,
          id: existing.id,
          error: updErr?.message,
        });
      } else {
        const { data: newVessel, error: insErr } = await supabase
          .from("vessels")
          .insert(vessel)
          .select("id")
          .single();
        results.push({
          vessel: vessel.vessel_name,
          created: true,
          id: newVessel?.id,
          error: insErr?.message,
        });
      }
    }

    return NextResponse.json({
      ok: results.every((r) => !r.error),
      anna_contact_linked: !!anna?.id,
      vessels: results,
    });
  } catch (err) {
    console.error("[seed-vessels] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
