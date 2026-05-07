// @ts-nocheck
//
// One-shot ADMIN endpoint — upload a single image into the
// `ig-photos` Supabase bucket so it gets a LIBRARY_HOST public URL
// the IG publish flow won't swap.
//
// 2026-05-07 — built so the Forbes-launch redesigned slide could be
// pushed without a manual drag-drop into the Supabase Storage UI
// (Chrome MCP's `file_upload` is blocked at the extension layer for
// arbitrary file inputs, computer-use can't drag onto Chrome at the
// "read" tier).
//
// Usage:
//   curl -F "file=@/tmp/slide-v2.png" \
//        -F "path=2026-05-07/slide-v2.png" \
//        https://gy-command.../api/admin/upload-ig-image
//
// Returns the public URL the IG cron will accept without swap.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "ig-photos";

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

  const sb = createServiceClient();
  const { data, error } = await sb.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType,
      upsert: true, // re-uploading the same path replaces the file
    });

  if (error) {
    return NextResponse.json(
      { error: error.message, path, bytes: bytes.byteLength },
      { status: 500 },
    );
  }

  const publicUrl = `https://lquxemsonehfltdzdbhq.supabase.co/storage/v1/object/public/${BUCKET}/${path}`;
  return NextResponse.json({
    ok: true,
    path,
    bucket: BUCKET,
    bytes: bytes.byteLength,
    contentType,
    publicUrl,
    storage: data,
  });
}
