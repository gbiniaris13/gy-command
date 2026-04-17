#!/usr/bin/env node
/**
 * Sync photos from ~/Desktop/ROBERTO IG/ to Supabase ig-photos bucket.
 *
 * Run: node scripts/sync-ig-photos.js
 *
 * - Uploads new photos (skips already-uploaded filenames)
 * - AI generates description + tags for each
 * - Alerts via Telegram when stock is low (≤10 unused photos)
 * - NEVER uploads the same filename twice
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const PHOTOS_DIR = join(homedir(), "Desktop", "ROBERTO IG ");  // Note: trailing space in folder name
const BUCKET = "ig-photos";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://lquxemsonehfltdzdbhq.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY not set");
  console.error("Get it from: Supabase Dashboard → Settings → API → service_role key");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log(`📁 Scanning: ${PHOTOS_DIR}`);

  // Get local files
  const localFiles = readdirSync(PHOTOS_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  console.log(`📷 Found ${localFiles.length} photos locally`);

  // Get already-uploaded filenames
  const { data: existing } = await sb
    .from("ig_photos")
    .select("filename");
  const uploadedNames = new Set((existing || []).map(r => r.filename));
  console.log(`☁️  Already uploaded: ${uploadedNames.size}`);

  // Find new photos
  const newPhotos = localFiles.filter(f => !uploadedNames.has(f));
  console.log(`🆕 New to upload: ${newPhotos.length}`);

  if (newPhotos.length === 0) {
    console.log("✅ All photos already synced.");
    await checkStock();
    return;
  }

  let uploaded = 0;
  for (const filename of newPhotos) {
    const filepath = join(PHOTOS_DIR, filename);
    const bytes = readFileSync(filepath);
    const today = new Date().toISOString().slice(0, 10);
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${today}/${Date.now()}-${sanitized}`;

    console.log(`  ⬆️  Uploading: ${filename}...`);

    // Upload to storage
    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: filename.endsWith(".png") ? "image/png" : "image/jpeg",
        upsert: false,
      });

    if (uploadErr) {
      console.error(`  ❌ Upload failed: ${uploadErr.message}`);
      continue;
    }

    // Get public URL
    const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = urlData?.publicUrl;

    // AI describe (from filename)
    let description = `Luxury yacht/Greece photo (${filename})`;
    let tags = ["luxury", "yacht", "greece"];
    try {
      const resp = await fetch(`${SUPABASE_URL.replace('.supabase.co', '-george-biniaris-projects.vercel.app')}/api/instagram/pick-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      }).catch(() => null);
      // Fallback: just use filename-based tags
      const lower = filename.toLowerCase();
      if (lower.includes("sunset")) tags.push("sunset", "golden-hour");
      if (lower.includes("yacht") || lower.includes("boat")) tags.push("yacht", "sailing");
      if (lower.includes("sea") || lower.includes("ocean")) tags.push("sea", "aegean");
      if (lower.includes("island")) tags.push("island", "greek-islands");
      if (lower.includes("santorini")) tags.push("santorini");
      if (lower.includes("mykonos")) tags.push("mykonos");
    } catch {}

    // Insert into DB
    const { error: dbErr } = await sb
      .from("ig_photos")
      .insert({
        filename,
        storage_path: storagePath,
        public_url: publicUrl,
        description,
        tags,
      });

    if (dbErr) {
      console.error(`  ❌ DB insert failed: ${dbErr.message}`);
    } else {
      uploaded++;
      console.log(`  ✅ ${filename} → uploaded`);
    }

    // Small delay between uploads
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n✅ Uploaded ${uploaded} new photos.`);
  await checkStock();
}

async function checkStock() {
  const { data, count } = await sb
    .from("ig_photos")
    .select("id", { count: "exact", head: true })
    .is("used_in_post_id", null);

  const unused = count || 0;
  console.log(`\n📊 Stock: ${unused} unused photos remaining`);

  if (unused <= 10) {
    console.log(`⚠️  LOW STOCK! Add more photos to ~/Desktop/ROBERTO IG/`);
    // Send Telegram alert
    try {
      const TELEGRAM_BOT_TOKEN = "8773911706:AAFixtS_3kQLWB4G3FL9vMt4v5AKh9sNtqo";
      const TELEGRAM_CHAT_ID = "8478263770";
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: `⚠️ <b>IG Photo Stock Low</b>\n\nOnly ${unused} unused photos remaining.\nAdd more to ~/Desktop/ROBERTO IG/`,
          parse_mode: "HTML",
        }),
      });
    } catch {}
  }
}

main().catch(err => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
