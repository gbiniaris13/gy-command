// src/lib/helm/storage.ts
// Supabase Storage for generated proposal PDFs. Private bucket
// 'helm-proposals' (proposals are confidential); the detail page streams
// them through an admin-gated route, never a public URL.

import { createServiceClient } from "../supabase-server";

export const PROPOSALS_BUCKET = "helm-proposals";

/** The bucket was created with a modest per-file cap, so a rich multi-yacht
 *  proposal (every photo inlined) hit "The object exceeded the maximum allowed
 *  size" at the very last step, AFTER the render - all of the broker's work
 *  still safe in the draft, but no PDF. The service role can widen the bucket
 *  itself, so we do that here instead of asking anyone to open a dashboard.
 *  Fail-open: if the update is rejected we still attempt the upload. */
const PROPOSAL_MAX_BYTES = 50 * 1024 * 1024; // 50 MB, the platform per-file cap

async function widenBucketLimit(db: ReturnType<typeof createServiceClient>): Promise<void> {
  try {
    // public:false is REQUIRED and deliberate - updateBucket rewrites the whole
    // config, and proposals are confidential. Never flip this to true.
    await db.storage.updateBucket(PROPOSALS_BUCKET, {
      public: false,
      fileSizeLimit: PROPOSAL_MAX_BYTES,
    });
  } catch { /* fail-open — the upload below reports the real outcome */ }
}

/** Upload (or overwrite) the proposal PDF for a request. Returns the path. */
export async function uploadProposalPdf(
  requestId: string,
  bytes: Uint8Array,
): Promise<string> {
  const db = createServiceClient();
  const path = `${requestId}.pdf`;
  const put = () =>
    db.storage
      .from(PROPOSALS_BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });

  let { error } = await put();
  // Size rejection => widen the bucket once and retry the same bytes.
  if (error && /maximum allowed size|exceeded|too large|413/i.test(error.message)) {
    await widenBucketLimit(db);
    ({ error } = await put());
  }
  if (error) {
    const mb = (bytes.byteLength / 1024 / 1024).toFixed(1);
    if (/maximum allowed size|exceeded|too large|413/i.test(error.message)) {
      throw new Error(
        `The generated PDF is ${mb} MB, which is over the storage limit for this project. ` +
        `Nothing was lost - your saved draft, yachts and photos are intact. ` +
        `Remove or exclude a few yachts (or replace the heaviest photos) and press Generate again.`,
      );
    }
    throw new Error(`storage upload failed (${mb} MB): ${error.message}`);
  }
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
/** Same brochures/<id>/<slug>-<ts>.pdf path scheme used by both the server-side
 *  upload and the browser direct-upload (createBrochureUploadUrl). */
function brochurePath(requestId: string, filename: string): string {
  const slug =
    (filename || "brochure")
      .replace(/\.pdf$/i, "")
      .replace(/[^a-z0-9.-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 60) || "brochure";
  return `brochures/${requestId}/${slug}-${Date.now().toString(36)}.pdf`;
}

export async function uploadBrochurePdf(
  requestId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<string> {
  const db = createServiceClient();
  const path = brochurePath(requestId, filename);
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

/** Create a one-time signed UPLOAD URL so the BROWSER can put a large brochure
 *  PDF straight into our storage, bypassing Vercel's ~4.5MB serverless body cap.
 *  Returns the same brochures/<id>/<slug>-<ts>.pdf path scheme as uploadBrochurePdf
 *  plus the upload token. The client uploads with uploadToSignedUrl(path, token, file),
 *  then the finalize-brochure action mints a long-lived signed DOWNLOAD URL. */
export async function createBrochureUploadUrl(
  requestId: string,
  filename: string,
): Promise<{ path: string; token: string }> {
  const db = createServiceClient();
  const path = brochurePath(requestId, filename);
  const { data, error } = await db.storage
    .from(PROPOSALS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.token) {
    throw new Error(`brochure upload URL failed: ${error?.message ?? "no token"}`);
  }
  return { path, token: data.token };
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
