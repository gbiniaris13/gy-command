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
import { addVesselPhoto, removeVesselPhoto, setBrochureUrl, setCombinedMedia } from "@/lib/helm-admin";
import { isCloudinaryConfigured, uploadToCloudinary, slugifyFilename } from "@/lib/helm/cloudinary";
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
    // Combined multi-yacht: a per-yacht photo/brochure is tagged with its index.
    const rawIdx = form.get("yacht_index");
    const yachtIndex = rawIdx !== null && rawIdx !== "" ? Number(rawIdx) : null;
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
      const isPdf = (file.type || "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name || "");
      // Cloudinary's free tier caps raw files at 10MB — return a friendly,
      // actionable note instead of a cryptic SDK error.
      if (isPdf && buf.length > 10 * 1024 * 1024) {
        return NextResponse.json({ error: `This PDF is ${(buf.length / 1024 / 1024).toFixed(1)}MB - the free hosting limit is 10MB. Compress it (macOS Preview: File > Export > Quartz Filter > Reduce File Size) and upload again.` }, { status: 400 });
      }
      const dataUri = `data:${file.type || "application/octet-stream"};base64,${buf.toString("base64")}`;
      // PDFs upload as RAW with the .pdf extension inside the public_id — only
      // then does the delivery URL carry content-type application/pdf, so the
      // proposal's gold brochure button opens INLINE in the client's browser.
      // Images keep the previous behaviour exactly.
      const secureUrl = isPdf
        ? await uploadToCloudinary(dataUri, {
            folder: `helm/${id}`,
            resourceType: "raw",
            publicId: `${slugifyFilename(file.name || "brochure")}-${Date.now().toString(36)}.pdf`,
          })
        : await uploadToCloudinary(dataUri, { folder: `helm/${id}`, resourceType: "auto" });
      // GUARD: never store a brochure link the client could not open. Cloudinary
      // accounts block .pdf delivery by default (Security setting); verify the
      // public URL actually serves before saving it.
      if (isPdf) {
        const head = await fetch(secureUrl, { method: "HEAD" }).catch(() => null);
        if (!head || !head.ok) {
          return NextResponse.json({ error: "Cloudinary is blocking PDF delivery on this account. One-time fix: cloudinary.com console > Settings > Security > enable 'Allow delivery of PDF and ZIP files', then upload again. (The link was NOT saved, so nothing broken reaches a client.)" }, { status: 400 });
        }
      }
      // Combined per-yacht media → combined_media[index], not the single-yacht arrays.
      if (yachtIndex !== null && Number.isFinite(yachtIndex)) {
        const patch = kind === "brochure" ? { brochure_url: secureUrl } : { main_url: secureUrl };
        const combined_media = await setCombinedMedia(id, yachtIndex, patch);
        return NextResponse.json({ ok: true, configured: true, kind, yacht_index: yachtIndex, url: secureUrl, combined_media });
      }
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
      // ---- combined multi-yacht per-yacht media (by index) ----
      case "set-combined-link": {
        const idx = Number(body.index);
        const field = body.field === "brochure_url" ? "brochure_url" : "main_url";
        if (!Number.isFinite(idx) || !body.url) return NextResponse.json({ error: "index + url required" }, { status: 400 });
        const combined_media = await setCombinedMedia(id, idx, { [field]: String(body.url) });
        const note = field === "brochure_url" ? agencyDomainWarning(String(body.url)) : undefined;
        return NextResponse.json({ ok: true, combined_media, note });
      }
      case "remove-combined": {
        const idx = Number(body.index);
        const field = body.field === "brochure_url" ? "brochure_url" : "main_url";
        if (!Number.isFinite(idx)) return NextResponse.json({ error: "index required" }, { status: 400 });
        const combined_media = await setCombinedMedia(id, idx, { [field]: null });
        return NextResponse.json({ ok: true, combined_media });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
