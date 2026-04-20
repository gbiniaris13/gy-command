#!/usr/bin/env node
/**
 * Sync videos from ~/Desktop/ROBERTO IG videos/ to Supabase Storage.
 *
 * Run: node scripts/sync-ig-videos.js
 *
 * Mirrors the photo sync flow but for videos (reels).
 * Hits the deployed /api/instagram/videos/upload endpoint.
 *
 * Accepted: .mp4, .mov (max 100 MB, max 90s — validated server-side
 * once the reels cron lands in Phase C).
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const VIDEOS_DIR = join(homedir(), "Desktop", "ROBERTO IG videos");
const API_BASE = "https://gy-command-george-biniaris-projects.vercel.app";
const TELEGRAM_BOT_TOKEN = "8773911706:AAFixtS_3kQLWB4G3FL9vMt4v5AKh9sNtqo";
const TELEGRAM_CHAT_ID = "8478263770";

const MAX_SIZE_MB = 100;
const SUPPORTED_EXT = /\.(mp4|mov)$/i;

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function main() {
  console.log(`🎥 Scanning: ${VIDEOS_DIR}`);

  let localFiles = [];
  try {
    localFiles = readdirSync(VIDEOS_DIR).filter((f) => SUPPORTED_EXT.test(f));
  } catch (err) {
    console.error(`❌ Folder not found: ${VIDEOS_DIR}`);
    console.error(`   Create it first: mkdir "${VIDEOS_DIR}"`);
    process.exit(1);
  }
  console.log(`🎬 Found ${localFiles.length} videos locally`);

  // Size-check before upload — IG hard cap is 100 MB per video.
  const oversized = [];
  for (const f of localFiles) {
    const sizeMb = statSync(join(VIDEOS_DIR, f)).size / (1024 * 1024);
    if (sizeMb > MAX_SIZE_MB) oversized.push(`${f} (${sizeMb.toFixed(1)} MB)`);
  }
  if (oversized.length > 0) {
    console.error(`⚠  ${oversized.length} file(s) exceed ${MAX_SIZE_MB} MB, skipping:`);
    oversized.forEach((o) => console.error(`   - ${o}`));
    await sendTelegram(`⚠ Some videos exceed ${MAX_SIZE_MB} MB and were skipped:\n${oversized.join("\n")}`);
  }
  const eligible = localFiles.filter((f) => {
    const sizeMb = statSync(join(VIDEOS_DIR, f)).size / (1024 * 1024);
    return sizeMb <= MAX_SIZE_MB;
  });

  // Get already-uploaded filenames from API
  const existingRes = await fetch(`${API_BASE}/api/instagram/videos/upload`);
  if (!existingRes.ok) {
    console.error(`❌ API not ready yet (returned ${existingRes.status}).`);
    console.error(`   Deploy the videos/upload endpoint first (Phase C).`);
    process.exit(1);
  }
  const existingData = await existingRes.json();
  const uploadedNames = new Set((existingData.videos || []).map((v) => v.filename));
  console.log(`☁️  Already uploaded: ${uploadedNames.size}`);

  const newVideos = eligible.filter((f) => !uploadedNames.has(f));
  console.log(`🆕 New to upload: ${newVideos.length}`);

  if (newVideos.length === 0) {
    console.log("✅ All videos already synced.");
    return;
  }

  let uploaded = 0;
  for (const filename of newVideos) {
    const filepath = join(VIDEOS_DIR, filename);
    const bytes = readFileSync(filepath);
    const sizeMb = (bytes.length / (1024 * 1024)).toFixed(1);

    console.log(`  ⬆️  Uploading: ${filename} (${sizeMb} MB)...`);

    const formData = new FormData();
    const mime = filename.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4";
    formData.append("file", new Blob([bytes], { type: mime }), filename);

    try {
      const res = await fetch(`${API_BASE}/api/instagram/videos/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        uploaded++;
        console.log(`  ✅ ${filename}`);
      } else {
        console.error(`  ❌ ${filename}: ${data.error || "unknown error"}`);
      }
    } catch (err) {
      console.error(`  ❌ ${filename}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n✅ Done. Uploaded ${uploaded} / ${newVideos.length}`);
  await sendTelegram(`🎬 Video sync complete: uploaded ${uploaded} / ${newVideos.length}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
