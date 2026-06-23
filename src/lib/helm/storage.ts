// src/lib/helm/storage.ts
// Supabase Storage for generated proposal PDFs. Private bucket
// 'helm-proposals' (proposals are confidential); the detail page streams
// them through an admin-gated route, never a public URL.

import { createServiceClient } from "../supabase-server";

export const PROPOSALS_BUCKET = "helm-proposals";

/** Upload (or overwrite) the proposal PDF for a request. Returns the path. */
export async function uploadProposalPdf(
  requestId: string,
  bytes: Uint8Array,
): Promise<string> {
  const db = createServiceClient();
  const path = `${requestId}.pdf`;
  const { error } = await db.storage
    .from(PROPOSALS_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return path;
}

/** Download the stored proposal PDF bytes (for the admin-gated stream route). */
export async function downloadProposalPdf(path: string): Promise<Uint8Array> {
  const db = createServiceClient();
  const { data, error } = await db.storage.from(PROPOSALS_BUCKET).download(path);
  if (error || !data) throw new Error(`storage download failed: ${error?.message ?? "no data"}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Upload a brochure PDF to OUR OWN storage (reuses the private helm-proposals
 *  bucket under a brochures/ prefix) and return a long-lived signed URL.
 *  This is deliberately independent of Cloudinary — Cloudinary accounts block
 *  PDF delivery by a console security toggle, so brochure PDFs live here instead
 *  and "just work" (free, no per-account setup). The link is embedded in the
 *  proposal's gold brochure button; 5 years easily outlives any charter cycle. */
export async function uploadBrochurePdf(
  requestId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<string> {
  const db = createServiceClient();
  const slug =
    (filename || "brochure")
      .replace(/\.pdf$/i, "")
      .replace(/[^a-z0-9.-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 60) || "brochure";
  const path = `brochures/${requestId}/${slug}-${Date.now().toString(36)}.pdf`;
  const { error } = await db.storage
    .from(PROPOSALS_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`brochure upload failed: ${error.message}`);
  const { data, error: signErr } = await db.storage
    .from(PROPOSALS_BUCKET)
    .createSignedUrl(path, 5 * 365 * 24 * 3600);
  if (signErr || !data?.signedUrl) {
    throw new Error(`brochure signed URL failed: ${signErr?.message ?? "no url"}`);
  }
  return data.signedUrl;
}

/** Time-limited signed URL to the (private) proposal PDF — for sharing by
 *  WhatsApp or manually, without making the bucket public. Default 7 days. */
export async function getSignedProposalUrl(
  path: string,
  expiresIn = 7 * 24 * 3600,
): Promise<string> {
  const db = createServiceClient();
  const { data, error } = await db.storage
    .from(PROPOSALS_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(`signed URL failed: ${error?.message ?? "no url"}`);
  }
  return data.signedUrl;
}
