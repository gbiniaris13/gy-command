#!/usr/bin/env node
/**
 * Sync videos from ~/Desktop/ROBERTO IG videos/ to Supabase Storage.
 *
 * Run: node scripts/sync-ig-videos.js
 *
 * Uses a 2-step signed-URL upload so we bypass Vercel's 4.5 MB
 * serverless body limit (which the direct /api/instagram/videos/upload
 * endpoint inherits). Flow per file:
 *
 *   1. POST /api/instagram/videos/init-upload { filename, size }
 *      → { signedUrl, storagePath }
 *   2. PUT  <signedUrl> with the file bytes (direct to Supabase,
 *      no ceiling, same bandwidth either way).
 *   3. POST /api/instagram/videos/complete-upload { storagePath, filename, size }
 *      → { video: { id, filename, public_url, ... } }
 *
 * Accepted: .mp4, .mov, .m4v, .webm (max 100 MB — IG Graph API hard cap).
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const VIDEOS_DIR = join(homedir(), "Desktop", "ROBERTO IG videos");
const API_BASE = "https://gy-command-george-biniaris-projects.vercel.app";
const TELEGRAM_BOT_TOKEN = "8773911706:AAFixtS_3kQLWB4G3FL9vMt4v5AKh9sNtqo";
const TELEGRAM_CHAT_ID = "8478263770";

const MAX_SIZE_MB = 100;
const SUPPORTED_EXT = /\.(mp4|mov|m4v|webm)$/i;

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function uploadOne(filename, filepath, sizeBytes) {
  // Step 1 — get signed URL
  const initRes = await fetch(`${API_BASE}/api/instagram/videos/init-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, size: sizeBytes }),
  });
  if (!initRes.ok) {
    const txt = await initRes.text().catch(() => "");
    throw new Error(`init-upload ${initRes.status}: ${txt.slice(0, 200)}`);
  }
  const initData = await initRes.json();
  const { signedUrl, storagePath } = initData;
  if (!signedUrl || !storagePath) {
    throw new Error(`init-upload missing fields: ${JSON.stringify(initData).slice(0, 200)}`);
  }

  // Step 2 — PUT bytes directly to Supabase (no Vercel ceiling)
  const bytes = readFileSync(filepath);
  const mime = filename.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4";
  const putRes = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: bytes,
  });
  if (!putRes.ok) {
    const txt = await putRes.text().catch(() => "");
    throw new Error(`PUT ${putRes.status}: ${txt.slice(0, 200)}`);
  }

  // Step 3 — register metadata + Gemini description
  const completeRes = await fetch(`${API_BASE}/api/instagram/videos/complete-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storagePath, filename, size: sizeBytes }),
  });
  if (!completeRes.ok) {
    const txt = await completeRes.text().catch(() => "");
    throw new Error(`complete-upload ${completeRes.status}: ${txt.slice(0, 200)}`);
  }
  return await completeRes.json();
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

  const oversized = [];
  const eligible = [];
  for (const f of localFiles) {
    const sizeBytes = statSync(join(VIDEOS_DIR, f)).size;
    const sizeMb = sizeBytes / (1024 * 1024);
    if (sizeMb > MAX_SIZE_MB) {
      oversized.push(`${f} (${sizeMb.toFixed(1)} MB)`);
    } else {
      eligible.push({ filename: f, sizeBytes, sizeMb });
    }
  }
  if (oversized.length > 0) {
    console.error(`⚠  ${oversized.length} file(s) exceed ${MAX_SIZE_MB} MB, skipping:`);
    oversized.forEach((o) => console.error(`   - ${o}`));
  }

  // Dedup vs already-uploaded filenames
  const existingRes = await fetch(`${API_BASE}/api/instagram/videos/upload`);
  if (!existingRes.ok) {
    console.error(`❌ /videos/upload GET returned ${existingRes.status}.`);
    process.exit(1);
  }
  const existingData = await existingRes.json();
  const uploadedNames = new Set((existingData.videos || []).map((v) => v.filename));
  console.log(`☁️  Already uploaded: ${uploadedNames.size}`);

  const newVideos = eligible.filter((v) => !uploadedNames.has(v.filename));
  console.log(`🆕 New to upload: ${newVideos.length}`);

  if (newVideos.length === 0) {
    console.log("✅ All videos already synced.");
    return;
  }

  let uploaded = 0;
  let failed = 0;
  for (const { filename, sizeBytes, sizeMb } of newVideos) {
    const filepath = join(VIDEOS_DIR, filename);
    console.log(`  ⬆️  Uploading: ${filename} (${sizeMb.toFixed(1)} MB)...`);
    try {
      await uploadOne(filename, filepath, sizeBytes);
      uploaded++;
      console.log(`  ✅ ${filename}`);
    } catch (err) {
      failed++;
      console.error(`  ❌ ${filename}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n✅ Done. Uploaded ${uploaded} / ${newVideos.length} (${failed} failed)`);
  await sendTelegram(
    `🎬 Video sync complete: uploaded ${uploaded} / ${newVideos.length}` +
      (failed > 0 ? ` (${failed} failed)` : "") +
      (oversized.length > 0 ? `\n\n⚠ ${oversized.length} file(s) > ${MAX_SIZE_MB} MB skipped.` : ""),
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
