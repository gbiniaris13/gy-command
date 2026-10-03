// THE FLEET BOOK: every yacht written once, read by every proposal.
import { listDossiers, listSiteYachts, dossierKey } from "@/lib/helm/dossier";
import FleetBook from "./FleetBook";

export const dynamic = "force-dynamic";

export default async function FleetBookPage() {
  const dossiers = await listDossiers();
  const have = new Set(dossiers.map((d) => d.key));
  const site = (await listSiteYachts())
    .filter((y) => !have.has(dossierKey(y.name)))
    .map((y) => ({ name: y.name, slug: y.slug, category: y.category ?? null, photo: y.images?.[0]?.url ?? null }));
  return <FleetBook dossiers={dossiers} site={site} />;
}
