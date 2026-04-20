// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";

// POST /api/instagram/videos/upload
//
// Companion to /api/instagram/photos/upload — mirrors the same flow
// for reel-sized videos. George drops .mp4 / .mov files into
// ~/Desktop/ROBERTO IG videos/ and `scripts/sync-ig-videos.js` feeds
// them through here. Two things happen on upload:
//
//   1. The bytes land in Supabase Storage bucket `ig-videos` (created
//      idempotently on first POST — no manual bucket setup needed).
//   2. A metadata row is written to the `settings` KV table with key
//      `video_<uuid>` and a JSON value containing filename, public URL,
//      AI-generated description, tags, and used_in_post_id (starts null
//      so the reels cron can pick from unused videos).
//
// We use `settings` instead of a dedicated `ig_videos` table because
// there's no DDL path available (no psql / supabase CLI in the runtime).
// This is the same pattern the story rotation fix uses.
//
// The reels publish cron (Phase C) will read these rows with
// `key LIKE 'video_%'` and parse the JSON.

const BUCKET = "ig-videos";
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB — IG Graph API hard cap

async function ensureBucket(sb: ReturnType<typeof createServiceClient>) {
  // Idempotent create. Supabase throws "Bucket already exists" if it's
  // there; we swallow that specific error.
  try {
    const { error } = await sb.storage.createBucket(BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message || "")) {
      throw error;
    }
  } catch (err: any) {
    if (!/already exists/i.test(err?.message || "")) throw err;
  }
}

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
    const raw = await aiChat(
      "You return only JSON. No markdown, no prose.",
      prompt,
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
      description: "luxury yacht clip from the Greek islands",
      tags: ["yacht", "greece", "vertical", "cruising"],
    };
  }
}

function generateId(): string {
  return (
    "v_" +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36)
  );
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "Missing file — send multipart/form-data with a `file` field" },
        { status: 400 },
      );
    }

    const f = file as File;
    const filename = f.name || `upload-${Date.now()}.mp4`;
    const size = f.size ?? 0;

    if (!/\.(mp4|mov|m4v|webm)$/i.test(filename)) {
      return NextResponse.json(
        { error: "Only .mp4 / .mov / .m4v / .webm accepted" },
        { status: 400 },
      );
    }
    if (size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `File too large (${(size / 1024 / 1024).toFixed(1)} MB). IG Graph API max: 100 MB.`,
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await f.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const today = new Date().toISOString().slice(0, 10);
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${today}/${Date.now()}-${sanitized}`;

    const sb = createServiceClient();

    await ensureBucket(sb);

    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: f.type || "video/mp4",
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json(
        {
          error: "Storage upload failed",
          detail: uploadErr.message,
        },
        { status: 502 },
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
      size_mb: Number((size / 1024 / 1024).toFixed(2)),
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
      // Storage succeeded but metadata didn't land — best-effort cleanup.
      await sb.storage.from(BUCKET).remove([storagePath]).catch(() => {});
      return NextResponse.json(
        { error: "Metadata insert failed", detail: insertErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, video: metadata });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upload failed" },
      { status: 500 },
    );
  }
}

// GET /api/instagram/videos/upload — lists all uploaded videos.
// The sync script uses this for filename dedup.
export async function GET() {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("settings")
    .select("key, value")
    .like("key", "video_%")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ videos: [], error: error.message }, { status: 500 });
  }

  const videos = (data ?? [])
    .map((row) => {
      try {
        return JSON.parse(row.value);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return NextResponse.json({ videos });
}
