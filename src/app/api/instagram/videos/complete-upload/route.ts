// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";

// POST /api/instagram/videos/complete-upload
//
// Step 2 of 2. After the client has PUT the video bytes to the
// pre-signed URL from init-upload, it calls this endpoint with the
// storagePath + filename to:
//   1. Resolve the public URL for the uploaded file.
//   2. Ask Gemini for a description + tags from the filename.
//   3. Insert a settings row with key `video_<id>` and a JSON value.
//
// Small payload — a few hundred bytes — well under the Vercel 4.5 MB
// serverless body limit, so no upload ceiling concerns here.

const BUCKET = "ig-videos";

async function describeVideoFilename(filename: string): Promise<{
  description: string;
  tags: string[];
}> {
  const prompt = `You are a luxury yacht cinematographer classifying a video clip for the @georgeyachts Instagram Reels feed. Filename: "${filename}".

Respond ONLY with a JSON object:
{
  "description": "<two-sentence guess of what the clip shows — yacht type, setting, mood, movement, likely reel topic>",
  "tags": ["<3-8 lowercase tags: vertical, aerial, drone, sunset, cyclades, interior, cruising, deck, aft, foredeck, timelapse>"]
}

Infer from the filename only. If the filename is a generic id (e.g. pexels-2045739), use generic luxury yacht / Greek sea tags.`;

  try {
    const raw = await aiChat("You return only JSON. No markdown, no prose.", prompt);
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
      description: "luxury yacht clip from the Greek islands",
      tags: ["yacht", "greece", "vertical", "cruising"],
    };
  }
}

function generateId(): string {
  return (
    "v_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

export async function POST(req: NextRequest) {
  try {
    const { storagePath, filename, size } = await req.json();
    if (!storagePath || !filename) {
      return NextResponse.json(
        { error: "Missing storagePath or filename" },
        { status: 400 },
      );
    }

    const sb = createServiceClient();

    // Confirm the object actually exists in storage before we register
    // metadata. Catches the edge where the client never actually PUT
    // the bytes.
    const { data: headData, error: headErr } = await sb.storage
      .from(BUCKET)
      .list(storagePath.split("/").slice(0, -1).join("/"), {
        search: storagePath.split("/").pop(),
      });
    if (headErr || !headData || headData.length === 0) {
      return NextResponse.json(
        { error: "Upload not found in storage — did PUT succeed?" },
        { status: 400 },
      );
    }

    const { data: publicData } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = publicData?.publicUrl;
    if (!publicUrl) {
      return NextResponse.json(
        { error: "Could not resolve public URL" },
        { status: 500 },
      );
    }

    const { description, tags } = await describeVideoFilename(filename);
    const id = generateId();
    const now = new Date().toISOString();
    const metadata = {
      id,
      filename,
      storage_path: storagePath,
      public_url: publicUrl,
      size_mb: size ? Number((Number(size) / 1024 / 1024).toFixed(2)) : null,
      description,
      tags,
      used_in_post_id: null,
      uploaded_at: now,
    };

    const { error: insertErr } = await sb.from("settings").insert({
      key: `video_${id}`,
      value: JSON.stringify(metadata),
      updated_at: now,
    });

    if (insertErr) {
      return NextResponse.json(
        { error: "Metadata insert failed", detail: insertErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, video: metadata });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "complete-upload failed" },
      { status: 500 },
    );
  }
}
