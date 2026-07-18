// src/lib/helm/cloudinary.ts
// =============================================================
// Cloudinary media hosting for The Helm (NOT Supabase Storage —
// the org is over its Supabase storage quota). Server-side signed
// uploads via the cloudinary SDK. Configured from CLOUDINARY_URL
// (preferred) or the three CLOUDINARY_* vars. If neither is set,
// isCloudinaryConfigured() returns false and callers degrade
// gracefully (paste-link still works) — never crash.
// =============================================================

import { v2 as cloudinary } from "cloudinary";

let _configured: boolean | null = null;

export function isCloudinaryConfigured(): boolean {
  if (_configured !== null) return _configured;
  if (process.env.CLOUDINARY_URL) {
    // The SDK auto-reads CLOUDINARY_URL on first use.
    _configured = true;
  } else if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    _configured = true;
  } else {
    _configured = false;
  }
  return _configured;
}

/** Upload a data-URI (or remote URL) to Cloudinary. Throws
 *  "CLOUDINARY_NOT_CONFIGURED" if no creds — callers handle gracefully.
 *  publicId: set explicitly for raw files (PDFs) — a raw delivery URL only
 *  carries the right content-type when the extension is part of the public_id. */
export async function uploadToCloudinary(
  dataUriOrUrl: string,
  opts: { folder: string; resourceType?: "image" | "auto" | "raw"; publicId?: string },
): Promise<string> {
  if (!isCloudinaryConfigured()) throw new Error("CLOUDINARY_NOT_CONFIGURED");
  const res = await cloudinary.uploader.upload(dataUriOrUrl, {
    folder: opts.folder,
    resource_type: opts.resourceType ?? "auto",
    ...(opts.publicId ? { public_id: opts.publicId } : {}),
    overwrite: false,
  });
  return res.secure_url;
}

/** Signed params for a DIRECT browser -> Cloudinary video upload (2026-07-16,
 *  the Salon personal video). George's 60-90s iPhone clip is far over
 *  Vercel's ~4.5MB body cap, so the browser posts the file straight to
 *  api.cloudinary.com with this server-minted signature — our lambda never
 *  carries the bytes. Free-plan cap is ~100MB/video (1080p advised). */
export function signVideoUpload(folder: string): {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
} {
  if (!isCloudinaryConfigured()) throw new Error("CLOUDINARY_NOT_CONFIGURED");
  const cfg = cloudinary.config();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request({ folder, timestamp }, String(cfg.api_secret));
  return { cloudName: String(cfg.cloud_name), apiKey: String(cfg.api_key), timestamp, signature, folder };
}

/** Filename -> URL-safe slug: lowercase, accents stripped, hyphens only.
 *  "Lagoon 50 Brochure.PDF" -> "lagoon-50-brochure". */
export function slugifyFilename(name: string): string {
  const slug = name
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "brochure";
}

/** Web-optimized delivery URL for embedding into the proposal PDF and Salon
 *  (keeps render fast + Cloudinary credits low). ONLY genuine Cloudinary
 *  delivery URLs take the transformation segment — a pasted supplier link that
 *  merely happens to contain "/upload/" (e.g. alphayachting.com/images/upload/…)
 *  must pass through untouched, else the injected w_/q_/f_ path 404s and the
 *  photo vanishes from the Salon (ZALINA in Nick's proposal, 2026-07-18). */
export function optimizedUrl(secureUrl: string, width = 1200): string {
  if (!secureUrl.includes("res.cloudinary.com")) return secureUrl;
  if (!secureUrl.includes("/upload/")) return secureUrl;
  return secureUrl.replace("/upload/", `/upload/w_${width},q_auto,f_auto/`);
}
