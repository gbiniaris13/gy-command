// gy-command — Edit cabin basics.
// Same pattern as /dashboard/cabins/new but PATCH-mode: pre-fills
// every cabin-level field (vessel, ports, dates, charter fee,
// principal charterer, internal ops) so George can fix typos
// after creation without deleting & rebuilding the cabin.
//
// Brief content (the 9 JSONB sections) is edited from /edit; crew
// + menu + vessel-brochure JSONB from /content. This page is just
// the top-level columns on the `cabins` table.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCabin, refreshBerthNearby } from "@/lib/cabin-admin";
import EditBasicsForm from "./EditBasicsForm";

export const dynamic = "force-dynamic";

export default async function EditCabinBasicsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();

  // 2026-05-23 — Berth Map Phase 2 backfill.
  // George's directive: "Αυτόματα θέλω να γίνεται, δεν θα τα κάνω
  // εγώ χειροκίνητα." Most cabins had berth coordinates set BEFORE
  // Phase 2 deployed, so updateCabin()'s save-time hook hasn't run
  // for them. Fire here as a one-time background backfill: opens the
  // Edit Basics page once → background fetch fills berth_nearby
  // within ~10s → next page reload shows the data. Zero clicks.
  const hasBerthCoords =
    typeof cabin.berth_lat === "number" &&
    typeof cabin.berth_lng === "number" &&
    Number.isFinite(cabin.berth_lat) &&
    Number.isFinite(cabin.berth_lng);
  const hasCachedNearby = !!cabin.berth_nearby;
  if (hasBerthCoords && !hasCachedNearby) {
    // Fire-and-forget. Page renders immediately. If Overpass/OSRM
    // are slow, the panel will show "Not fetched yet" on first
    // load and the data appears on next router.refresh() / reload.
    void refreshBerthNearby(
      id,
      cabin.berth_lat as number,
      cabin.berth_lng as number,
    ).catch((e) =>
      console.error("[edit-basics] auto-backfill berth_nearby failed:", e),
    );
  }

  return (
    <EditBasicsForm
      cabinId={id}
      initial={{
        vessel_name: cabin.vessel_name ?? "",
        vessel_make_model: cabin.vessel_make_model ?? "",
        vessel_length: cabin.vessel_length ?? "",
        vessel_capacity: cabin.vessel_capacity != null ? String(cabin.vessel_capacity) : "",
        homeport: cabin.homeport ?? "",
        myba_contract_number: cabin.myba_contract_number ?? "",
        charter_period_from: cabin.charter_period_from ?? "",
        charter_period_to: cabin.charter_period_to ?? "",
        port_embarkation: cabin.port_embarkation ?? "",
        port_disembarkation: cabin.port_disembarkation ?? "",
        cruising_area: cabin.cruising_area ?? "",
        principal_charterer_name: cabin.principal_charterer_name ?? "",
        principal_charterer_email: cabin.principal_charterer_email ?? "",
        principal_charterer_mobile: cabin.principal_charterer_mobile ?? "",
        captain_name_internal: cabin.captain_name_internal ?? "",
        chef_name_internal: cabin.chef_name_internal ?? "",
        hostess_name_internal: cabin.hostess_name_internal ?? "",
        charter_fee_eur: cabin.charter_fee_eur != null ? String(cabin.charter_fee_eur) : "",
        apa_eur: cabin.apa_eur != null ? String(cabin.apa_eur) : "",
        // 2026-05-23 — Berth Map Phase 1.
        berth_label: cabin.berth_label ?? "",
        berth_lat: cabin.berth_lat != null ? String(cabin.berth_lat) : "",
        berth_lng: cabin.berth_lng != null ? String(cabin.berth_lng) : "",
      }}
      nearbyState={{
        // 2026-05-23 — Berth Map Phase 2 status panel.
        fetched_at: cabin.berth_nearby_fetched_at ?? null,
        error: cabin.berth_nearby_error ?? null,
        summary: summariseNearby(cabin.berth_nearby),
      }}
    />
  );
}

// Compact one-liner for the CRM panel — shows ✓ for found, ✗ for
// missing for ALL categories so George sees at a glance what's
// there AND what failed. Critical for diagnosing partial fetches.
function summariseNearby(nearby: unknown): string | null {
  if (!nearby || typeof nearby !== "object") return null;
  const n = nearby as Record<string, unknown>;
  const parts: string[] = [];
  parts.push(n.airport ? "Airport ✓" : "Airport ✗");
  parts.push(n.helipad ? "Helipad ✓" : "Helipad ✗");
  const atms = Array.isArray(n.atms) ? n.atms.length : 0;
  parts.push(atms > 0 ? `${atms} ATM${atms === 1 ? "" : "s"}` : "ATMs ✗");
  parts.push(n.hospital ? "Hospital ✓" : "Hospital ✗");
  parts.push(n.pharmacy ? "Pharmacy ✓" : "Pharmacy ✗");
  return parts.join(" · ");
}
