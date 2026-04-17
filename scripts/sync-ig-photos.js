#!/usr/bin/env node
/**
 * Sync photos from ~/Desktop/ROBERTO IG/ to Supabase via Vercel API.
 *
 * Run: node scripts/sync-ig-photos.js
 *
 * Uses the deployed /api/instagram/photos/upload endpoint (has service role key).
 * No local Supabase credentials needed.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const PHOTOS_DIR = join(homedir(), "Desktop", "ROBERTO IG ");
const API_BASE = "https://gy-command-george-biniaris-projects.vercel.app";
const TELEGRAM_BOT_TOKEN = "8773911706:AAFixtS_3kQLWB4G3FL9vMt4v5AKh9sNtqo";
const TELEGRAM_CHAT_ID = "8478263770";

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function main() {
  console.log(`📁 Scanning: ${PHOTOS_DIR}`);

  // Get local files
  const localFiles = readdirSync(PHOTOS_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  console.log(`📷 Found ${localFiles.length} photos locally`);

  // Get already-uploaded filenames from API
  const existingRes = await fetch(`${API_BASE}/api/instagram/photos/upload`);
  const existingData = await existingRes.json();
  const uploadedNames = new Set((existingData.photos || []).map(p => p.filename));
  console.log(`☁️  Already uploaded: ${uploadedNames.size}`);

  // Find new photos
  const newPhotos = localFiles.filter(f => !uploadedNames.has(f));
  console.log(`🆕 New to upload: ${newPhotos.length}`);

  if (newPhotos.length === 0) {
    console.log("✅ All photos already synced.");
    await checkStock(existingData.photos || []);
    return;
  }

  let uploaded = 0;
  for (const filename of newPhotos) {
    const filepath = join(PHOTOS_DIR, filename);
    const bytes = readFileSync(filepath);

    console.log(`  ⬆️  Uploading: ${filename}...`);

    // Upload via Vercel API (multipart form)
    const formData = new FormData();
    formData.append("file", new Blob([bytes], { type: filename.endsWith(".png") ? "image/png" : "image/jpeg" }), filename);

    try {
      const res = await fetch(`${API_BASE}/api/instagram/photos/upload`, {
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

    // Small delay
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n✅ Uploaded ${uploaded} new photos.`);

  // Recheck stock
  const refreshRes = await fetch(`${API_BASE}/api/instagram/photos/upload`);
  const refreshData = await refreshRes.json();
  await checkStock(refreshData.photos || []);
}

async function checkStock(photos) {
  const unused = photos.filter(p => !p.used_in_post_id).length;
  const total = photos.length;
  console.log(`\n📊 Stock: ${unused} unused / ${total} total`);

  if (unused <= 10) {
    console.log(`⚠️  LOW STOCK! Add more photos to ~/Desktop/ROBERTO IG/`);
    await sendTelegram(
      `⚠️ <b>IG Photo Stock Low</b>\n\n` +
      `Only <b>${unused}</b> unused photos remaining.\n` +
      `Add more to ~/Desktop/ROBERTO IG/`
    );
  }
}

main().catch(err => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
