// gy-command — Guest manifest editor.
// Tabular form for every guest aboard: full name, DOB, nationality,
// passport (number + expiry), cabin pairing, shoe size, allergies.
// Feeds the preference sheet's Guest Manifest section and the
// captain's port-authority paperwork.

import { notFound } from "next/navigation";
import { getCabin, getCabinGuestsManifest } from "@/lib/cabin-admin";
import ManifestForm from "./ManifestForm";

export const dynamic = "force-dynamic";

export default async function CabinManifestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();

  const manifest = await getCabinGuestsManifest(id);

  return (
    <ManifestForm
      cabinId={id}
      cabinLabel={`${cabin.vessel_name}${cabin.vessel_make_model ? " · " + cabin.vessel_make_model : ""}`}
      principalCharterer={{
        full_name: cabin.principal_charterer_name ?? "",
        email: cabin.principal_charterer_email ?? "",
        mobile: cabin.principal_charterer_mobile ?? "",
      }}
      initial={manifest as Array<Record<string, unknown>>}
    />
  );
}
