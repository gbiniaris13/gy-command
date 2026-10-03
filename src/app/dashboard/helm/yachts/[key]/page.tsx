// One folder of the Fleet Book: the editor with a live "as the client sees it".
import { getDossier } from "@/lib/helm/dossier";
import { isCloudinaryConfigured } from "@/lib/helm/cloudinary";
import DossierEditor from "./DossierEditor";

export const dynamic = "force-dynamic";

export default async function DossierPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ site?: string }> }) {
  const { key } = await params;
  const sp = await searchParams;
  const k = decodeURIComponent(key);
  const dossier = k === "new" ? null : await getDossier(k);
  return <DossierEditor initial={dossier} isNew={k === "new"} siteSlug={sp.site ?? null} canUpload={isCloudinaryConfigured()} />;
}
