// @ts-nocheck
import { NextResponse } from "next/server";

export const maxDuration = 300;

import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import { createServiceClient } from "@/lib/supabase-server";
import { loadReelState, saveReelState, reelCandidates, prepareReel, cleanupReel, readReady, writeReady } from "@/lib/reel-build";

// Cron: Tuesday and Thursday, 12:00 and 14:00 UTC, hours before the reel
// is due (16:00 UTC, /api/cron/instagram-reel).
//
// Makes that evening's walkthrough reel and leaves it ready: picks the
// next cleared yacht with a film, stores the film, looks at still frames
// of the chosen stretch for anyone else's name, logo or caption, lays
// George's words over it. The 14:00 run is a second chance and does
// nothing when a reel is already waiting.
//
// A yacht whose every stretch is marked is set aside for sixty days. If
// no reel can be made, nothing is left waiting and the evening's job
// publishes a yacht carousel instead: the day is never silent.

const FLAG_KEY = "reel_posts_enabled";
/** A waiting reel older than this is thrown away and made again. */
const READY_MAX_AGE_MS = 3 * 86_400_000;

function appBase(): string {
  const host =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    "https://command.georgeyachts.com";
  return host.startsWith("http") ? host : `https://${host}`;
}

async function _observedImpl() {
  const started = Date.now();
  const sb = createServiceClient();
  const { data: flag } = await sb.from("settings").select("value").eq("key", FLAG_KEY).maybeSingle();
  if (flag?.value === "false") return NextResponse.json({ skipped: "reel_posts_disabled" });

  const waiting = await readReady();
  if (waiting) {
    if (Date.now() - new Date(waiting.preparedAt).getTime() < READY_MAX_AGE_MS) {
      return NextResponse.json({ skipped: "a reel is already waiting", yacht: waiting.yachtName });
    }
    await cleanupReel(waiting.slug);
    await writeReady(null);
  }

  const state = await loadReelState();
  const candidates = await reelCandidates(state);
  if (!candidates.length) {
    await sendTelegram("⚠ Reel: no cleared yacht with a usable film is left to show. Tonight a yacht carousel goes out instead.");
    return NextResponse.json({ error: "no candidates" });
  }

  const tried: any[] = [];
  for (const yacht of candidates.slice(0, 4)) {
    // Leave room: a film takes up to a minute to store, check and compose.
    if (Date.now() - started > 190_000) break;
    const result = await prepareReel(yacht, appBase(), { deadlineMs: started + 270_000 });
    if (result.ok) {
      await writeReady(result.reel);
      await sendTelegram(
        [
          `🎬 <b>Reel ready for tonight:</b> ${yacht.name}`,
          `Seconds ${result.reel.window.start} to ${result.reel.window.start + result.reel.window.length} of her film, frames: ${result.reel.frames.join(", ")}`,
          `Frame check: clean (${result.checks.map((c) => c.verdict).join(", ")})`,
          `Look at it: ${result.reel.videoUrl}`,
        ].join("\n"),
      );
      return NextResponse.json({ ok: true, yacht: yacht.name, video_url: result.reel.videoUrl, tried });
    }
    tried.push({ yacht: yacht.name, why: result.why });
    await cleanupReel(String(yacht.slug ?? yacht._id));
    if (result.marked) {
      state.rejected[yacht._id] = { at: new Date().toISOString(), why: result.why };
      await saveReelState(state);
    }
  }

  await sendTelegram(
    `⚠ Reel: none could be made this run.\n${tried.map((t) => `· ${t.yacht}: ${t.why}`).join("\n")}\nIf the next run fails too, tonight a yacht carousel goes out instead.`,
  );
  return NextResponse.json({ error: "no reel made", tried });
}

export async function GET(...args: any[]) {
  return observeCron("instagram-reel-prepare", () => (_observedImpl as any)(...args));
}
