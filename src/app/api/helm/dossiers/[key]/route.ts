// One folder of the Fleet Book.
//   GET    /api/helm/dossiers/:key                      → { dossier }
//   POST   /api/helm/dossiers/:key  { action: "from-site", slug? } → the folder as the site
//                                    would fill it (NOT saved; the editor shows it, George saves)
//   POST   /api/helm/dossiers/:key  multipart { file }  → photo to Cloudinary, returns { url }
//   DELETE /api/helm/dossiers/:key                      → remove (George's explicit act)

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { getDossier, fetchSiteYacht, dossierFromSite, removeDossier, dossierKey } from "@/lib/helm/dossier";
import { isCloudinaryConfigured, uploadToCloudinary, slugifyFilename } from "@/lib/helm/cloudinary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const { key } = await ctx.params;
  const dossier = await getDossier(decodeURIComponent(key));
  if (!dossier) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({ ok: true, dossier });
}

export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const { key } = await ctx.params;
  const k = decodeURIComponent(key);
  const ctype = req.headers.get("content-type") || "";

  if (ctype.includes("multipart/form-data")) {
    if (!isCloudinaryConfigured()) return NextResponse.json({ error: "Photo hosting is not connected. Paste a link instead." }, { status: 400 });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
    if (!(file.type || "").startsWith("image/")) return NextResponse.json({ error: "Photos only." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "That photo is over 20MB." }, { status: 413 });
    const buf = Buffer.from(await file.arrayBuffer());
    const dataUri = `data:${file.type};base64,${buf.toString("base64")}`;
    try {
      const url = await uploadToCloudinary(dataUri, { folder: `helm/fleet-book/${dossierKey(k) || "yacht"}`, resourceType: "image", publicId: `${Date.now()}-${slugifyFilename(file.name)}` });
      return NextResponse.json({ ok: true, url });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  const body = await req.json().catch(() => ({}));
  if (body?.action === "from-site") {
    const existing = await getDossier(k);
    const y = await fetchSiteYacht(String(body.slug || existing?.sanity_slug || existing?.name || k));
    if (!y) return NextResponse.json({ error: "No yacht on the site matches this name. Check the spelling, or type the folder by hand." }, { status: 404 });
    const fresh = dossierFromSite(y, body.by || undefined);
    // The site fills the blanks and refreshes the facts; George's private
    // notes and anything he typed that the site does not carry survive.
    const merged = { ...fresh, ...(existing?.notes ? { notes: existing.notes } : {}) };
    return NextResponse.json({ ok: true, dossier: merged, matched: y.name });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const { key } = await ctx.params;
  await removeDossier(decodeURIComponent(key));
  return NextResponse.json({ ok: true });
}
