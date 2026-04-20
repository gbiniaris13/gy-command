// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// POST /api/instagram/videos/init-upload
//
// Step 1 of 2 for the large-file video upload dance. The direct
// /api/instagram/videos/upload endpoint hits Vercel's 4.5 MB serverless
// body limit — fatal for typical reel clips (10-60 MB). This endpoint
// sidesteps that by returning a pre-signed Supabase Storage URL that
// the client PUTs the bytes to directly, bypassing Vercel entirely.
//
// Flow:
//   1. Client POSTs { filename, size } here.
//   2. We create the ig-videos bucket if missing, generate a unique
//      storage path, and call supabase.storage.createSignedUploadUrl.
//   3. Client PUTs the video bytes to the returned signedUrl.
//   4. Client POSTs /api/instagram/videos/complete-upload to register
//      metadata + run Gemini description.
//
// The signed URL is valid for 2 hours; plenty for a 100 MB upload
// over a regular home connection.

const BUCKET = "ig-videos";
const MAX_BYTES = 100 * 1024 * 1024;

async function ensureBucket(sb: ReturnType<typeof createServiceClient>) {
  // Create if missing. Supabase returns a "already exists" error we swallow.
  try {
    const { error } = await sb.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
    });
    if (error && !/already exists/i.test(error.message || "")) {
      throw error;
    }
  } catch (err: any) {
    if (!/already exists/i.test(err?.message || "")) throw err;
  }

  // Idempotent: always raise the file-size limit to 100 MB. Supabase's
  // default is 50 MB, which kills any reel clip over that size with a
  // 413 "object exceeded maximum allowed size". Updating an existing
  // bucket's limit is a no-op if it already matches.
  try {
    await sb.storage.updateBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
    });
  } catch {
    // Fail-open — worst case the upload itself returns 413 and the
    // script reports it per-file. We still attempt the upload.
  }
}

export async function POST(req: NextRequest) {
  try {
    const { filename, size } = await req.json();
    if (!filename || typeof filename !== "string") {
      return NextResponse.json(
        { error: "Missing filename" },
        { status: 400 },
      );
    }
    if (!/\.(mp4|mov|m4v|webm)$/i.test(filename)) {
      return NextResponse.json(
        { error: "Only .mp4 / .mov / .m4v / .webm accepted" },
        { status: 400 },
      );
    }
    const sizeNum = Number(size ?? 0);
    if (sizeNum > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `File too large (${(sizeNum / 1024 / 1024).toFixed(1)} MB). IG Graph API max: 100 MB.`,
        },
        { status: 400 },
      );
    }

    const sb = createServiceClient();
    await ensureBucket(sb);

    const today = new Date().toISOString().slice(0, 10);
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${today}/${Date.now()}-${sanitized}`;

    const { data, error } = await sb.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error) {
      return NextResponse.json(
        { error: "Failed to sign upload URL", detail: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      signedUrl: data.signedUrl,
      storagePath,
      token: data.token,
      bucket: BUCKET,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "init-upload failed" },
      { status: 500 },
    );
  }
}
