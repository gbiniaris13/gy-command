// POST /api/helm/:id/upload-media — vessel photos + brochure, hosted on
// Cloudinary (NOT Supabase Storage). Admin-gated. Two request shapes:
//   • multipart/form-data: { file, kind: "photo" | "brochure" } → Cloudinary upload
//   • application/json:     { action: "add-photo-link" | "remove-photo" |
//                             "add-brochure-link" | "remove-brochure", url? }
// Degrades gracefully when Cloudinary is not configured (paste-link still
// works; file upload returns a friendly "not connected" note, never crashes).

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { addVesselPhoto, removeVesselPhoto, setBrochureUrl } from "@/lib/helm-admin";
import { isCloudinaryConfigured, uploadToCloudinary } from "@/lib/helm/cloudinary";
import { agencyDomainWarning } from "@/lib/helm/media";

export const runtime = "nodejs";
export const maxDuration = 60;

async function adminEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const jar = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ctype = req.headers.get("content-type") || "";

  // ---- file upload (multipart) → Cloudinary ----
  if (ctype.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); } catch { return NextResponse.json({ error: "bad form" }, { status: 400 }); }
    const file = form.get("file");
    const kind = String(form.get("kind") || "photo");
    if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });

    if (!isCloudinaryConfigured()) {
      // graceful degrade — never crash the page
      return NextResponse.json({
        ok: false,
        configured: false,
        message: "Cloudinary is not connected yet. Paste an image/brochure link instead, or add CLOUDINARY_URL in Vercel.",
      });
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const dataUri = `data:${file.type || "application/octet-stream"};base64,${buf.toString("base64")}`;
      const secureUrl = await uploadToCloudinary(dataUri, { folder: `helm/${id}`, resourceType: "auto" });
      if (kind === "brochure") {
        await setBrochureUrl(id, secureUrl);
        return NextResponse.json({ ok: true, configured: true, kind: "brochure", url: secureUrl });
      }
      const photos = await addVesselPhoto(id, { url: secureUrl, source: "upload" });
      return NextResponse.json({ ok: true, configured: true, kind: "photo", url: secureUrl, vessel_photos: photos });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ---- JSON actions (links / remove) — no Cloudinary needed ----
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !body.action) {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  try {
    switch (body.action) {
      case "add-photo-link": {
        if (!body.url) return NextResponse.json({ error: "url required" }, { status: 400 });
        // An image's source URL never appears in the client PDF (photos are
        // base64-embedded at render), so an agency-domain image link is safe;
        // we still surface a soft note for the operator.
        const photos = await addVesselPhoto(id, { url: String(body.url), source: "link" });
        return NextResponse.json({ ok: true, vessel_photos: photos, note: agencyDomainWarning(String(body.url)) });
      }
      case "remove-photo": {
        const photos = await removeVesselPhoto(id, String(body.url || ""));
        return NextResponse.json({ ok: true, vessel_photos: photos });
      }
      case "add-brochure-link": {
        if (!body.url) return NextResponse.json({ error: "url required" }, { status: 400 });
        await setBrochureUrl(id, String(body.url));
        // Warn if it's an agency domain — it will be withheld from the client PDF.
        return NextResponse.json({ ok: true, brochure_url: String(body.url), warning: agencyDomainWarning(String(body.url)) });
      }
      case "remove-brochure": {
        await setBrochureUrl(id, null);
        return NextResponse.json({ ok: true, brochure_url: null });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
