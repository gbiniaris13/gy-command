// @ts-nocheck
// Makes a walkthrough reel out of a yacht's own film. The plan (which
// stretch, which words, what recipe) is src/lib/reel-plan.ts; this file
// does the work that needs the media store, the vision check and the
// database.
//
// Everything happens in Cloudinary's free plan: the film is stored once
// (gy-ig/reels/src/<slug>), still frames of the chosen stretch are read
// for the logo check, the three transparent frames are stored as pictures
// (gy-ig/reels/frames/), and the reel itself is a derived version of the
// stored film. Once a reel is published, the film and the frames are
// deleted again (cleanupReel), so storage does not grow.

import OpenAI from "openai";
import { v2 as cloudinary } from "cloudinary";
import { createServiceClient } from "@/lib/supabase-server";
import { fetchFleetPool } from "@/lib/sanity-fleet";
import {
  buildReelFrames, frameTimes, candidateWindows, checkOffsets, stretchVerdict, reelTransformation, reelCaption,
  FRAME_CHECK_PROMPT, REEL,
} from "@/lib/reel-plan";

const STATE_KEY = "reel_state_v1";
export const READY_KEY = "reel_ready_v1";
/** A film found marked is looked at again after this long (the site may have replaced it). */
const RECHECK_MS = 60 * 86_400_000;

let _cfg = false;
function cld() {
  if (!_cfg) {
    cloudinary.config({ secure: true }); // reads CLOUDINARY_URL
    if (!cloudinary.config().api_key) throw new Error("CLOUDINARY_NOT_CONFIGURED");
    _cfg = true;
  }
  return cloudinary;
}

const srcId = (slug: string) => `gy-ig/reels/src/${String(slug).replace(/[^a-z0-9-]/gi, "").slice(0, 60)}`;
const frameId = (slug: string, i: number) => `gy-ig/reels/frames/${String(slug).replace(/[^a-z0-9-]/gi, "").slice(0, 60)}-${i}`;

export type ReelState = {
  /** yacht id -> when her reel went out */
  posted: Record<string, string>;
  /** yacht id -> why her film cannot be used, and when that was found */
  rejected: Record<string, { at: string; why: string }>;
};

export async function loadReelState(): Promise<ReelState> {
  const sb = createServiceClient();
  const { data } = await sb.from("settings").select("value").eq("key", STATE_KEY).maybeSingle();
  try {
    const v = data?.value ? JSON.parse(data.value) : {};
    return { posted: v.posted ?? {}, rejected: v.rejected ?? {} };
  } catch {
    return { posted: {}, rejected: {} };
  }
}

export async function saveReelState(state: ReelState): Promise<void> {
  const sb = createServiceClient();
  try {
    await sb
      .from("settings")
      .upsert({ key: STATE_KEY, value: JSON.stringify(state), updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch {}
}

/**
 * The cleared yachts that could carry a reel, in the order to try them:
 * never shown first, then the one shown longest ago. A yacht needs a film
 * on the site and at least one thing written about her.
 */
export async function reelCandidates(state: ReelState): Promise<any[]> {
  const pool = await fetchFleetPool(); // already filtered against the social policy
  const now = Date.now();
  return pool
    .filter((y) => typeof y?.video?.url === "string" && /^https:\/\/cdn\.sanity\.io\//.test(y.video.url))
    .filter((y) => buildReelFrames(y).length > 0)
    .filter((y) => candidateWindows(Number(y.video.durationSeconds) || 0).length > 0 || !y.video.durationSeconds)
    .filter((y) => {
      const r = state.rejected[y._id];
      return !r || now - new Date(r.at).getTime() > RECHECK_MS;
    })
    .sort((a, b) => {
      const pa = state.posted[a._id] ? new Date(state.posted[a._id]).getTime() : 0;
      const pb = state.posted[b._id] ? new Date(state.posted[b._id]).getTime() : 0;
      return pa - pb || String(a._id).localeCompare(String(b._id));
    });
}

/** One still frame of the stored film, as a JPEG address. */
function stillUrl(publicId: string, second: number): string {
  return cld().url(publicId, {
    resource_type: "video",
    format: "jpg",
    secure: true,
    transformation: [{ start_offset: second }, { width: 768, crop: "scale" }],
  });
}

async function lookAtFrame(url: string): Promise<string | null> {
  if (!process.env.AI_API_KEY) return null;
  try {
    const ai = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: process.env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
    });
    const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || "gemini-2.5-flash";
    const res = await ai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 200,
      extra_body: { google: { thinking_config: { thinking_budget: 0, include_thoughts: false } } },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: FRAME_CHECK_PROMPT },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
    });
    return (res.choices[0]?.message?.content || "").trim();
  } catch (e) {
    console.error("[reel-build] frame check failed:", (e as Error)?.message);
    return null;
  }
}

/** Is this stretch of the film free of other people's names and marks? */
export async function checkStretch(publicId: string, win: { start: number; length: number }) {
  const offsets = checkOffsets(win);
  const answers: Array<string | null> = [];
  for (const s of offsets) {
    const url = stillUrl(publicId, s);
    // Cloudinary cuts the still on first request; warm it so the vision
    // model is not the one left waiting.
    try {
      await fetch(url, { signal: AbortSignal.timeout(20_000) });
    } catch {}
    const a = await lookAtFrame(url);
    answers.push(a);
    if (String(a ?? "").toUpperCase().startsWith("MARKED")) break; // one is enough
  }
  return { verdict: stretchVerdict(answers), answers, offsets: offsets.slice(0, answers.length) };
}

export type PreparedReel = {
  yachtId: string;
  yachtName: string;
  slug: string;
  videoUrl: string;
  caption: string;
  window: { start: number; length: number };
  frames: string[];
  heroUrl: string | null;
  preparedAt: string;
};

/**
 * Store the film, find a clean stretch, lay the frames over it.
 * Returns the finished reel's address, or why there is none.
 */
export async function prepareReel(
  yacht: any,
  appBaseUrl: string,
  opts: { deadlineMs?: number } = {},
): Promise<{ ok: true; reel: PreparedReel; checks: any[] } | { ok: false; why: string; marked?: boolean; checks?: any[] }> {
  const deadline = opts.deadlineMs ?? Date.now() + 200_000;
  const frames = buildReelFrames(yacht);
  if (!frames.length) return { ok: false, why: "nothing written about her to show" };
  const slug = String(yacht.slug ?? yacht._id);
  const c = cld();

  // 1. The film, stored once.
  let film;
  try {
    film = await c.uploader.upload(yacht.video.url, { resource_type: "video", public_id: srcId(slug), overwrite: true, timeout: 120_000 });
  } catch (e) {
    return { ok: false, why: `the film could not be stored: ${String((e as any)?.message ?? e).slice(0, 120)}` };
  }
  const duration = Number(film.duration) || Number(yacht.video.durationSeconds) || 0;
  if ((Number(film.width) || 0) < 960) return { ok: false, why: `the film is too small (${film.width}x${film.height})`, marked: true };
  const windows = candidateWindows(duration);
  if (!windows.length) return { ok: false, why: `the film is too short (${Math.round(duration)}s)`, marked: true };

  // 2. A stretch with nobody else's name on it.
  const checks: any[] = [];
  let win: { start: number; length: number } | null = null;
  let sawUnknown = false;
  for (const w of windows) {
    if (Date.now() > deadline - 90_000) break;
    const r = await checkStretch(srcId(slug), w);
    checks.push({ window: w, ...r });
    if (r.verdict === "clean") {
      win = w;
      break;
    }
    if (r.verdict === "unknown") sawUnknown = true;
  }
  if (!win) {
    // "Unknown" means the check itself did not answer: not a verdict on
    // the film, so she is not written off, only skipped this time.
    return {
      ok: false,
      why: sawUnknown ? "the frame check gave no answer" : "every stretch of her film shows a name, logo or caption",
      marked: !sawUnknown && checks.length === windows.length,
      checks,
    };
  }

  // 3. The frames, drawn here and stored as pictures.
  const times = frameTimes(frames.length, win.length);
  const overlays: Array<{ publicId: string; from: number; to: number | null }> = [];
  const secret = process.env.CRON_SECRET;
  for (let i = 0; i < frames.length; i++) {
    try {
      const res = await fetch(`${appBaseUrl}/api/og/reel-frame?frame=${encodeURIComponent(JSON.stringify(frames[i]))}`, {
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
        cache: "no-store",
        signal: AbortSignal.timeout(28_000),
      });
      if (!res.ok) return { ok: false, why: `frame ${i + 1} could not be drawn (HTTP ${res.status})`, checks };
      const buf = Buffer.from(await res.arrayBuffer());
      // PNG magic: 89 50 4E 47.
      if (buf.byteLength < 1000 || buf[0] !== 0x89 || buf[1] !== 0x50) return { ok: false, why: `frame ${i + 1} is not a PNG`, checks };
      await c.uploader.upload(`data:image/png;base64,${buf.toString("base64")}`, {
        public_id: frameId(slug, i),
        resource_type: "image",
        overwrite: true,
        invalidate: true,
      });
      overlays.push({ publicId: frameId(slug, i), ...times[i] });
    } catch (e) {
      return { ok: false, why: `frame ${i + 1} failed: ${String((e as any)?.message ?? e).slice(0, 100)}`, checks };
    }
  }

  // 4. The reel: a derived version of the stored film.
  const transformation = reelTransformation(win, overlays);
  let videoUrl: string;
  try {
    const ex = await c.uploader.explicit(srcId(slug), {
      resource_type: "video",
      type: "upload",
      eager: [{ transformation, format: "mp4" }],
      eager_async: true,
    });
    videoUrl = ex.eager?.[0]?.secure_url ?? c.url(srcId(slug), { resource_type: "video", format: "mp4", secure: true, transformation });
  } catch (e) {
    return { ok: false, why: `the reel could not be started: ${String((e as any)?.message ?? e).slice(0, 120)}`, checks };
  }
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const h = await fetch(videoUrl, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
      const type = h.headers.get("content-type") || "";
      if (h.ok && type.startsWith("video/") && Number(h.headers.get("content-length")) > 100_000) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 4000));
  }
  if (!ready) return { ok: false, why: "the reel was not ready in time", checks };

  return {
    ok: true,
    checks,
    reel: {
      yachtId: yacht._id,
      yachtName: yacht.name,
      slug,
      videoUrl,
      caption: reelCaption(yacht),
      window: win,
      frames: frames.map((f) => f.kind),
      heroUrl: yacht.images?.[0]?.url ?? null,
      preparedAt: new Date().toISOString(),
    },
  };
}

/** Delete the stored film, its derived versions and its frames. */
export async function cleanupReel(slug: string): Promise<void> {
  const c = cld();
  try {
    await c.uploader.destroy(srcId(slug), { resource_type: "video", invalidate: true });
  } catch {}
  for (let i = 0; i < 3; i++) {
    try {
      await c.uploader.destroy(frameId(slug, i), { resource_type: "image", invalidate: true });
    } catch {}
  }
}

export async function readReady(): Promise<PreparedReel | null> {
  const sb = createServiceClient();
  const { data } = await sb.from("settings").select("value").eq("key", READY_KEY).maybeSingle();
  try {
    const v = data?.value ? JSON.parse(data.value) : null;
    return v && v.videoUrl && v.yachtId ? v : null;
  } catch {
    return null;
  }
}

export async function writeReady(reel: PreparedReel | null): Promise<void> {
  const sb = createServiceClient();
  try {
    if (reel === null) await sb.from("settings").delete().eq("key", READY_KEY);
    else
      await sb
        .from("settings")
        .upsert({ key: READY_KEY, value: JSON.stringify(reel), updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch {}
}

export { REEL };
