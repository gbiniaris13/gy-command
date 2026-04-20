// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import {
  checkRateLimitHealth,
  logRateLimitAction,
} from "@/lib/rate-limit-guard";

// Cron: fleet story followup (Phase D.1.5).
//
// Consumes the `fleet_story_queue` that the fleet-post cron writes
// into the settings KV table. Each queue entry carries a fireAt
// timestamp (+48h from the feed post) and a photoUrl from the same
// yacht's Sanity library.
//
// Every firing:
//   1. Load the queue.
//   2. Pick entries whose fireAt has passed.
//   3. For each, publish a Story with the photo — same yacht as the
//      feed post 48h ago, different image. Two-touchpoint sequence
//      within a week = algorithm consolidation + memory imprint.
//   4. Remove fired entries from the queue.
//
// Idempotent, race-safe by removing the entry before posting — if
// two invocations fire within the same minute, only the first one
// sees the entry in the queue (serialization via upsert).
//
// Auto-publish, no approval gate. Post-facto Telegram report.

const STORY_QUEUE_KEY = "fleet_story_queue";
const FLAG_KEY = "fleet_posts_enabled";
const MAX_PER_TICK = 2; // belt + suspenders — never publish more than 2 followups per firing

async function readSetting(sb: any, key: string): Promise<string | null> {
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value ?? null;
}

async function writeQueue(sb: any, queue: any[]): Promise<void> {
  await sb
    .from("settings")
    .upsert(
      {
        key: STORY_QUEUE_KEY,
        value: JSON.stringify(queue),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    )
    .catch(() => {});
}

export async function GET() {
  const igToken = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return NextResponse.json({ error: "IG not configured" });
  }

  const sb = createServiceClient();

  // The followup cron respects the same master switch as the fleet
  // post cron. If George flips fleet_posts_enabled=false to kill the
  // pipeline, stale queue entries won't surprise him with stories.
  const flag = await readSetting(sb, FLAG_KEY);
  if (flag !== "true") {
    return NextResponse.json({ skipped: "fleet_posts_disabled" });
  }

  // Load queue.
  const raw = await readSetting(sb, STORY_QUEUE_KEY);
  let queue: any[] = [];
  try {
    queue = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(queue)) queue = [];
  } catch {
    queue = [];
  }
  if (queue.length === 0) return NextResponse.json({ skipped: "empty_queue" });

  const now = Date.now();
  const ready = queue.filter((q) => new Date(q.fireAt).getTime() <= now);
  const pending = queue.filter((q) => new Date(q.fireAt).getTime() > now);

  if (ready.length === 0) {
    return NextResponse.json({ skipped: "none_ready", pending: pending.length });
  }

  // Serialize: remove the ready slice from the queue BEFORE posting
  // so a concurrent tick doesn't double-fire the same followup.
  const toFire = ready.slice(0, MAX_PER_TICK);
  const stillPending = [...pending, ...ready.slice(MAX_PER_TICK)];
  await writeQueue(sb, stillPending);

  const results: any[] = [];
  for (const entry of toFire) {
    // Rate-limit breaker per-entry so a burst doesn't blow the story cap.
    if (!(await checkRateLimitHealth("story_publish"))) {
      // Put back the entries we haven't fired yet for next tick.
      stillPending.push(entry);
      continue;
    }

    try {
      // Step 1 — create story container.
      const createRes = await fetch(`https://graph.instagram.com/v21.0/${igId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: entry.photoUrl,
          media_type: "STORIES",
          access_token: igToken,
        }),
      });
      const createData = await createRes.json();
      if (!createData.id) {
        results.push({ yacht: entry.yachtName, error: createData.error?.message || "container failed" });
        continue;
      }

      // Step 2 — wait for processing.
      let ready2 = false;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const s = await fetch(
          `https://graph.instagram.com/v21.0/${createData.id}?fields=status_code&access_token=${encodeURIComponent(igToken)}`,
        );
        const sd = await s.json();
        if (sd.status_code === "FINISHED") {
          ready2 = true;
          break;
        }
        if (sd.status_code === "ERROR") break;
      }
      if (!ready2) {
        results.push({ yacht: entry.yachtName, error: "story processing timeout" });
        continue;
      }

      // Step 3 — publish.
      const pubRes = await fetch(`https://graph.instagram.com/v21.0/${igId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: createData.id,
          access_token: igToken,
        }),
      });
      const pubData = await pubRes.json();
      if (!pubData.id) {
        results.push({ yacht: entry.yachtName, error: pubData.error?.message || "publish failed" });
        continue;
      }

      await logRateLimitAction("story_publish", {
        media_id: pubData.id,
        kind: "fleet_followup",
        yacht_id: entry.yachtId,
      });

      await sendTelegram(
        [
          `📱 <b>Fleet story followup live:</b> ${entry.yachtName}`,
          `<i>48h after the feed carousel — 2-touchpoint sequence complete.</i>`,
          `Originating angle: <code>${entry.angle}</code>`,
        ].join("\n"),
      );

      results.push({ yacht: entry.yachtName, media_id: pubData.id, ok: true });
    } catch (err: any) {
      results.push({ yacht: entry.yachtName, error: err?.message ?? "unknown" });
    }
  }

  // Persist the final pending queue (includes any bumped entries).
  await writeQueue(sb, stillPending);

  return NextResponse.json({
    ok: true,
    fired: results.filter((r) => r.ok).length,
    failed: results.filter((r) => r.error).length,
    results,
    pending: stillPending.length,
  });
}
