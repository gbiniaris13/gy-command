// The Fleet Book API (2 October 2026).
//   GET  /api/helm/dossiers            → { dossiers, site: yachts on the site not yet in the book }
//   POST /api/helm/dossiers { dossier } → save (new or newest version)
// Cookie session or Bearer CRON_SECRET (requireUser).

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { listDossiers, listSiteYachts, saveDossier, dossierKey } from "@/lib/helm/dossier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const dossiers = await listDossiers();
  const withSite = url.searchParams.get("site") !== "0";
  let site: { name: string; slug: string; category?: string | null; photo?: string | null }[] = [];
  if (withSite) {
    const have = new Set(dossiers.map((d) => d.key));
    const all = await listSiteYachts();
    site = all
      .filter((y) => !have.has(dossierKey(y.name)))
      .map((y) => ({ name: y.name, slug: y.slug, category: y.category ?? null, photo: y.images?.[0]?.url ?? null }));
  }
  return NextResponse.json({ ok: true, dossiers, site });
}

export async function POST(req: Request) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  try {
    const d = await saveDossier(body?.dossier ?? body, body?.by || undefined);
    return NextResponse.json({ ok: true, dossier: d });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
