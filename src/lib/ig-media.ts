// @ts-nocheck
// =============================================================
// Instagram media library — Cloudinary backend.
//
// The IG bot's photos + reel videos live in Cloudinary (folder
// `gy-ig/`) since the org is over Supabase Storage's free quota
// (migrated off Supabase 2026-06-02). This module is the single
// place that knows WHERE library media lives, so the upload routes
// and the publish crons stay in sync.
//
// Cloudinary is configured from CLOUDINARY_URL (preferred) or the
// three CLOUDINARY_* vars — same contract as src/lib/helm/cloudinary.ts.
// =============================================================

import { v2 as cloudinary } from "cloudinary";

let _cfg = false;
function ensureConfig() {
  if (_cfg) return;
  cloudinary.config({ secure: true }); // SDK auto-reads CLOUDINARY_URL
  if (!cloudinary.config().api_key && process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }
  if (!cloudinary.config().api_key) throw new Error("CLOUDINARY_NOT_CONFIGURED");
  _cfg = true;
}

export const IG_PHOTO_FOLDER = "gy-ig/ig-photos";
export const IG_VIDEO_FOLDER = "gy-ig/ig-videos";

// Stable, collision-free public_id under a dated subfolder — mirrors
// the old Supabase storage_path convention (`<date>/<ts>-<name>`).
export function igPublicId(folder, filename) {
  const today = new Date().toISOString().slice(0, 10);
  const base = String(filename || "upload")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${folder}/${today}/${Date.now()}-${base}`;
}

// Server-side upload of raw image bytes. Returns { url, publicId }.
export async function uploadImageBytes(bytes, contentType, publicId, opts = {}) {
  ensureConfig();
  const dataUri = `data:${contentType || "image/jpeg"};base64,${Buffer.from(bytes).toString("base64")}`;
  const res = await cloudinary.uploader.upload(dataUri, {
    public_id: publicId,
    resource_type: "image",
    overwrite: opts.overwrite === true,
  });
  return { url: res.secure_url, publicId: res.public_id };
}

// Server-side upload of raw video bytes (only viable under Vercel's
// 4.5 MB body limit — the big-file path is the signed direct upload
// above). Returns { url, publicId }.
export async function uploadVideoBytes(bytes, contentType, publicId, opts = {}) {
  ensureConfig();
  const dataUri = `data:${contentType || "video/mp4"};base64,${Buffer.from(bytes).toString("base64")}`;
  const res = await cloudinary.uploader.upload(dataUri, {
    public_id: publicId,
    resource_type: "video",
    overwrite: opts.overwrite === true,
  });
  return { url: res.secure_url, publicId: res.public_id };
}

// Signed params for a direct script/browser -> Cloudinary video upload
// (bypasses Vercel's 4.5 MB serverless body limit, exactly like the old
// Supabase signed-upload URL did).
export function signedVideoUpload(publicId) {
  ensureConfig();
  const c = cloudinary.config();
  const timestamp = Math.round(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, public_id: publicId },
    c.api_secret,
  );
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${c.cloud_name}/video/upload`,
    apiKey: c.api_key,
    timestamp,
    signature,
    publicId,
  };
}

// Is this URL one of OUR library assets, so the publish cron must NOT
// swap it for a different photo? Covers the live Cloudinary library
// plus the legacy Supabase host (defensive — for any un-migrated row).
export function isLibraryUrl(url) {
  if (typeof url !== "string") return false;
  return (
    (url.includes("res.cloudinary.com") && url.includes("/gy-ig/")) ||
    url.includes("supabase.co/storage/v1/object/public/ig-")
  );
}
