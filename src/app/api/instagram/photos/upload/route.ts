// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";

// POST /api/instagram/photos/upload
//
// Multipart/form-data upload for the ROBERTO IG photo library. George
// drops photos into the dashboard upload zone; this endpoint:
//   1. Uploads the file bytes to the Supabase Storage `ig-photos` bucket
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

const BUCKET = "ig-photos";

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

    // Unique storage path so two uploads with the same filename don't
    // overwrite each other. Prefix with date so manual browsing in the
    // Supabase Storage UI stays sane.
    const today = new Date().toISOString().slice(0, 10);
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${today}/${Date.now()}-${sanitized}`;

    const sb = createServiceClient();

    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: (file as File).type || "image/jpeg",
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json(
        {
          error: "Storage upload failed",
          detail: uploadErr.message,
          hint:
            "Make sure the `ig-photos` bucket exists in Supabase Storage and is marked public.",
        },
        { status: 502 }
      );
    }

    const { data: publicData } = sb.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);
    const publicUrl = publicData?.publicUrl;
    if (!publicUrl) {
      return NextResponse.json(
        { error: "Could not resolve public URL" },
        { status: 500 }
      );
    }

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
export async function GET() {
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
