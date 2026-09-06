// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { igPublicId, uploadImageBytes, IG_PHOTO_FOLDER } from "@/lib/ig-media";
import { requireUser } from "@/lib/require-user";

// POST /api/instagram/photos/upload
//
// Multipart/form-data upload for the ROBERTO IG photo library. George
// drops photos into the dashboard upload zone; this endpoint:
//   1. Uploads the file bytes to Cloudinary (folder gy-ig/ig-photos —
//      the org is over Supabase's free Storage quota; migrated 2026-06-02)
//   2. Runs a Gemini description pass on the filename + any caller-
//      provided hint so the matcher has a text description to embed
//   3. Inserts a row in public.ig_photos with the public URL + metadata
//
// The AI description pass is intentionally small — just the filename
// and any caller hint text, NOT the image bytes. True image-to-text
// would need Gemini Vision and binary-safe aiChat; for now the AI
// works off the filename which George names deliberately. If the
// filename is useless ("IMG_4831.jpg"), the picker falls back to tag-
// based and random selection.

async function describeFilename(filename: string, hint?: string): Promise<{
  description: string;
  tags: string[];
}> {
  const prompt = `You are a luxury yacht photographer classifying photos for an Instagram feed. A photo file has been uploaded with filename "${filename}"${hint ? ` and a human hint: "${hint}"` : ""}.

Respond ONLY with a JSON object in this exact shape:
{
  "description": "<two-sentence description of what the photo likely shows, focused on content a caption matcher would care about — yacht type, setting, time of day, mood>",
  "tags": ["<3-8 lowercase single-word or hyphenated tags>"]
}

Infer from the filename and hint only. Don't see the image. If you can't tell, use generic luxury yacht tags.`;

  try {
    const raw = await aiChat(
      "You return only JSON. No markdown, no prose.",
      prompt
    );
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON");
    const parsed = JSON.parse(match[0]);
    return {
      description: String(parsed.description ?? "").slice(0, 400),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.slice(0, 8).map((t) => String(t).toLowerCase())
        : [],
    };
  } catch {
    return {
      description: `Luxury yacht photo (${filename})`,
      tags: ["luxury", "yacht"],
    };
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireUser(req);
  if (denied) return denied;
  try {
    const form = await req.formData();
    const file = form.get("file");
    const hint = (form.get("hint") as string | null) ?? undefined;

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "Missing file — send multipart/form-data with a `file` field" },
        { status: 400 }
      );
    }

    const filename = (file as File).name || `upload-${Date.now()}.jpg`;
    const arrayBuffer = await (file as File).arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Upload to Cloudinary under a dated public_id so two uploads with
    // the same filename don't collide. `storage_path` keeps the
    // Cloudinary public_id; `public_url` keeps the delivery URL the IG
    // publish flow hands to the Graph API.
    const publicId = igPublicId(IG_PHOTO_FOLDER, filename);

    let publicUrl: string;
    let storagePath: string;
    try {
      const up = await uploadImageBytes(
        bytes,
        (file as File).type || "image/jpeg",
        publicId,
      );
      publicUrl = up.url;
      storagePath = up.publicId;
    } catch (e) {
      return NextResponse.json(
        {
          error: "Cloudinary upload failed",
          detail: e instanceof Error ? e.message : String(e),
        },
        { status: 502 }
      );
    }

    const sb = createServiceClient();

    const { description, tags } = await describeFilename(filename, hint);

    const { data: inserted, error: insertErr } = await sb
      .from("ig_photos")
      .insert({
        filename,
        storage_path: storagePath,
        public_url: publicUrl,
        description,
        tags,
      })
      .select("*")
      .single();

    if (insertErr) {
      return NextResponse.json(
        { error: "DB insert failed", detail: insertErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, photo: inserted });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upload failed" },
      { status: 500 }
    );
  }
}

// GET /api/instagram/photos/upload — lists all uploaded photos for
// the dashboard grid view.
export async function GET(request: Request) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("ig_photos")
    .select("*")
    .order("uploaded_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ photos: [], error: error.message }, { status: 500 });
  }
  return NextResponse.json({ photos: data ?? [] });
}
