// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";

// POST /api/instagram/videos/complete-upload
//
// Step 2 of 2. After the client has POSTed the video bytes straight to
// Cloudinary (signed params from init-upload), it calls this endpoint
// with the Cloudinary { publicId, secureUrl } + filename to:
//   1. Ask Gemini for a description + tags from the filename.
//   2. Insert a settings row with key `video_<id>` and a JSON value
//      carrying the Cloudinary public_url the reels cron will read.
//
// Small payload — a few hundred bytes — well under the Vercel 4.5 MB
// serverless body limit, so no upload ceiling concerns here.

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
    const body = await req.json();
    // New (Cloudinary) contract: { publicId, secureUrl, filename, size }.
    const filename = body.filename;
    const publicUrl = body.secureUrl ?? body.public_url;
    const storagePath = body.publicId ?? body.public_id ?? null;
    if (!filename || !publicUrl) {
      return NextResponse.json(
        { error: "Missing filename or secureUrl" },
        { status: 400 },
      );
    }
    const size = body.size;

    const sb = createServiceClient();

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
