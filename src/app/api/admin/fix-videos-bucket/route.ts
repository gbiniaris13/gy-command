// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// GET /api/admin/fix-videos-bucket
//
// One-shot diagnostic + fixer for the ig-videos bucket. Lists the
// bucket's current config, forces an updateBucket to 100 MB, and
// re-lists the config so we can confirm the change actually took.
// Used when the in-line ensureBucket in init-upload silently failed
// to raise the default 50 MB Supabase Storage file-size cap.

const BUCKET = "ig-videos";
const MAX_BYTES = 100 * 1024 * 1024;

export async function GET() {
  const sb = createServiceClient();
  const result: any = { steps: [] };

  // 1. Get current bucket config.
  const { data: before, error: beforeErr } = await sb.storage.getBucket(BUCKET);
  result.steps.push({
    step: "getBucket (before)",
    error: beforeErr?.message ?? null,
    data: before ?? null,
  });

  // 2. Attempt update.
  const { data: updated, error: updErr } = await sb.storage.updateBucket(
    BUCKET,
    {
      public: true,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
    },
  );
  result.steps.push({
    step: "updateBucket",
    error: updErr?.message ?? null,
    data: updated ?? null,
  });

  // 3. Read back.
  const { data: after, error: afterErr } = await sb.storage.getBucket(BUCKET);
  result.steps.push({
    step: "getBucket (after)",
    error: afterErr?.message ?? null,
    data: after ?? null,
  });

  return NextResponse.json(result);
}
