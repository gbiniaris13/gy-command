// @ts-nocheck
//
// One-shot ADMIN endpoint — upload a single image into the Cloudinary
// IG library (folder gy-ig/ig-photos) so it gets a library URL the IG
// publish flow won't swap. (Media moved off Supabase Storage 2026-06-02
// — over free quota.)
//
// 2026-05-07 — built so the Forbes-launch redesigned slide could be
// pushed without a manual drag-drop into the storage UI.
//
// Usage:
//   curl -F "file=@/tmp/slide-v2.png" \
//        -F "path=2026-05-07/slide-v2.png" \
//        https://gy-command.../api/admin/upload-ig-image
//
// Returns the public URL the IG cron will accept without swap.

import { NextRequest, NextResponse } from "next/server";
import { uploadImageBytes, IG_PHOTO_FOLDER } from "@/lib/ig-media";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: "send multipart/form-data with `file` and `path` fields" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  const path = (form.get("path") as string | null)?.trim();

  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: "Missing file field (multipart/form-data with `file`)" },
      { status: 400 },
    );
  }
  if (!path) {
    return NextResponse.json(
      { error: "Missing path field (e.g. `path=2026-05-07/foo.png`)" },
      { status: 400 },
    );
  }
  if (path.includes("..")) {
    return NextResponse.json({ error: "path must not contain `..`" }, { status: 400 });
  }

  const f = file as File;
  const arrayBuffer = await f.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const contentType =
    f.type ||
    (path.endsWith(".png")
      ? "image/png"
      : path.endsWith(".jpg") || path.endsWith(".jpeg")
        ? "image/jpeg"
        : "application/octet-stream");

  // public_id mirrors the requested path (minus extension) under the
  // Cloudinary IG folder; overwrite so re-uploading the same path
  // replaces the asset (the old upsert:true semantics).
  const publicId = `${IG_PHOTO_FOLDER}/${path.replace(/\.[^/.]+$/, "")}`;
  let publicUrl: string;
  let storagePath: string;
  try {
    const up = await uploadImageBytes(bytes, contentType, publicId, { overwrite: true });
    publicUrl = up.url;
    storagePath = up.publicId;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), path, bytes: bytes.byteLength },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    path,
    publicId: storagePath,
    bytes: bytes.byteLength,
    contentType,
    publicUrl,
  });
}
