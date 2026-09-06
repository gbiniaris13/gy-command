// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { igPublicId, signedVideoUpload, IG_VIDEO_FOLDER } from "@/lib/ig-media";
import { requireUser } from "@/lib/require-user";

// POST /api/instagram/videos/init-upload
//
// Step 1 of 2 for the large-file video upload dance. The direct
// /api/instagram/videos/upload endpoint hits Vercel's 4.5 MB serverless
// body limit — fatal for typical reel clips (10-60 MB). This endpoint
// sidesteps that by returning Cloudinary SIGNED upload params; the
// client POSTs the bytes straight to Cloudinary, bypassing Vercel.
//
// (Media lives in Cloudinary, not Supabase — the org is over Supabase's
// free Storage quota; migrated 2026-06-02.)
//
// Flow:
//   1. Client POSTs { filename, size } here.
//   2. We compute a dated public_id and return { uploadUrl, apiKey,
//      timestamp, signature, publicId }.
//   3. Client POSTs the video as multipart/form-data to `uploadUrl`
//      with those signed fields → Cloudinary returns secure_url + public_id.
//   4. Client POSTs /api/instagram/videos/complete-upload to register
//      metadata + run Gemini description.

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB — IG Graph API hard cap

export async function POST(req: NextRequest) {
  const denied = await requireUser(req);
  if (denied) return denied;
  try {
    const { filename, size } = await req.json();
    if (!filename || typeof filename !== "string") {
      return NextResponse.json({ error: "Missing filename" }, { status: 400 });
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

    const publicId = igPublicId(IG_VIDEO_FOLDER, filename);
    let signed;
    try {
      signed = signedVideoUpload(publicId);
    } catch (e) {
      return NextResponse.json(
        { error: "Cloudinary not configured", detail: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, ...signed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "init-upload failed" },
      { status: 500 },
    );
  }
}
