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
 *  "CLOUDINARY_NOT_CONFIGURED" if no creds — callers handle gracefully. */
export async function uploadToCloudinary(
  dataUriOrUrl: string,
  opts: { folder: string; resourceType?: "image" | "auto" | "raw" },
): Promise<string> {
  if (!isCloudinaryConfigured()) throw new Error("CLOUDINARY_NOT_CONFIGURED");
  const res = await cloudinary.uploader.upload(dataUriOrUrl, {
    folder: opts.folder,
    resource_type: opts.resourceType ?? "auto",
    overwrite: false,
  });
  return res.secure_url;
}

/** Web-optimized delivery URL for embedding into the proposal PDF
 *  (keeps render fast + Cloudinary credits low). */
export function optimizedUrl(secureUrl: string, width = 1200): string {
  if (!secureUrl.includes("/upload/")) return secureUrl;
  return secureUrl.replace("/upload/", `/upload/w_${width},q_auto,f_auto/`);
}
