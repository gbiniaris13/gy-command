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
