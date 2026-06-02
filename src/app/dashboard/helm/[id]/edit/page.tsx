// The Helm — edit request page. Server component: loads the request via
// service-role and hands pre-filled values to the client edit form.

import Link from "next/link";
import { getRequest } from "@/lib/helm-admin";
import EditHelmForm, { type EditInitial } from "./EditHelmForm";

export const dynamic = "force-dynamic";

export default async function EditHelmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getRequest(id);

  if (!r) {
    return (
      <div style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
        <Link href="/dashboard/helm" style={{ color: "#0D1B2A", fontSize: 12 }}>← All requests</Link>
        <p style={{ marginTop: 20, color: "#6b7280", fontStyle: "italic" }}>Request not found.</p>
      </div>
    );
  }

  const initial: EditInitial = {
    request_type: r.request_type === "travel_agent" ? "travel_agent" : "direct_client",
    client_name: r.client_name ?? "",
    client_title: r.client_title ?? "Mr",
    client_surname: r.client_surname ?? "",
    client_is_family: !!r.client_is_family,
    client_email: r.client_email ?? "",
    client_whatsapp: r.client_whatsapp ?? "",
    central_agency_email: r.central_agency_email ?? "",
    occasion: r.occasion ?? "",
    party_size: r.party_size ?? "",
    dates_from: r.dates_from ?? "",
    dates_to: r.dates_to ?? "",
    area: r.area ?? "",
    budget: r.budget ?? "",
    special_requests: r.special_requests ?? "",
    brief: r.brief ?? "",
    supplier_raw: r.supplier_raw ?? "",
    mode: r.mode === "combined" ? "combined" : "single",
    no_myba: !!r.no_myba,
    show_ghost_credit: r.show_ghost_credit !== false,
  };

  return <EditHelmForm requestId={id} initial={initial} />;
}
