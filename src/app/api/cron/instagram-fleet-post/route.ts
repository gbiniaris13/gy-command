// @ts-nocheck
import { NextResponse } from "next/server";

// Carousel creation + processing + publish can take 60-90s even
// without jitter. Bump the Vercel serverless max duration (Pro cap
// is 300s) so we never get 504'd mid-publish.
export const maxDuration = 300;

import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import {
  applyPublishJitter,
  checkRateLimitHealth,
  logRateLimitAction,
} from "@/lib/rate-limit-guard";
import { assertPublishAllowed } from "@/lib/ig-window-guard";
import { stripBannedHashtags } from "@/lib/hashtag-guard";
import { isCaptionTooSimilar } from "@/lib/caption-similarity";
import { fetchFleetPool, buildFleetUTM } from "@/lib/sanity-fleet";
import { observeCron } from "@/lib/cron-observer";
import {
  loadRotationState,
  persistRotationState,
  selectNextYacht,
  selectAngle,
  updateStateAfterPost,
  eligibleAnglesForYacht,
} from "@/lib/fleet-rotation";
import {
  generateFleetCaption,
  fallbackFleetCaption,
  fleetHashtagBlock,
  captionVoiceAudit,
} from "@/lib/fleet-caption";
import { getIgTokenOptional } from "@/lib/ig-token";

// Cron: Instagram Fleet Post (Phase D.1).
//
// Publishes a carousel of a real yacht from the Sanity CMS fleet,
// selected via 14-day cooldown + per-angle eligibility rules. Auto-
// publishes from day one when settings.fleet_posts_enabled = "true".
// No approval gate — if George sees something off in the feed, he
// flips the flag back to false.
//
// Monitoring is post-facto: a Telegram summary fires after each
// successful publish with the caption preview, carousel count, IG
// link, and UTM so George can audit at a glance.
//
// Flag-gated (default disabled). Cap: fleet_posts_per_week setting
// (default 4). All Phase A safety guards (rate limit, jitter, banned
// hashtags, similarity check) apply.
//
// After a successful feed post, this cron also queues a same-yacht
// story followup for +48h (Phase D.1.5) — see instagram-fleet-story-
// followup for the consumer side.

const FLAG_KEY = "fleet_posts_enabled";
const PER_WEEK_CAP_KEY = "fleet_posts_per_week";
const STORY_QUEUE_KEY = "fleet_story_queue";
const DEFAULT_PER_WEEK = 4;
const STORY_FOLLOWUP_DELAY_MS = 48 * 60 * 60 * 1000;

async function readSetting(sb: any, key: string): Promise<string | null> {
  const { data } = await sb.from("settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

async function countFleetPostsSince(sb: any, sinceMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - sinceMs).toISOString();
  const { count } = await sb
    .from("settings")
    .select("*", { count: "exact", head: true })
    .like("key", "fleet_post_%")
    .gt("updated_at", cutoff);
  return count ?? 0;
}

async function queueStoryFollowup(
  sb: any,
  entry: { yachtId: string; yachtName: string; fireAt: string; photoUrl: string; angle: string },
): Promise<void> {
  // Single JSON row at STORY_QUEUE_KEY — array of pending entries.
  const current = await readSetting(sb, STORY_QUEUE_KEY);
  let queue: any[] = [];
  try {
    queue = current ? JSON.parse(current) : [];
    if (!Array.isArray(queue)) queue = [];
  } catch {
    queue = [];
  }
  queue.push(entry);
  // Prune old already-fired entries (fireAt > 5d past) so the blob stays small.
  const cutoff = Date.now() - 5 * 86400000;
  queue = queue.filter((q) => new Date(q.fireAt).getTime() >= cutoff);
  // NOTE: the Supabase PostgREST builder doesn't expose .catch() — wrap
  // in try/catch so a transient settings write failure doesn't bubble up
  // and blow the whole fleet-post flow after a successful publish.
  try {
    await sb.from("settings").upsert(
      {
        key: STORY_QUEUE_KEY,
        value: JSON.stringify(queue),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {}
}

async function _observedImpl() {
  const igToken = getIgTokenOptional();
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return NextResponse.json({ error: "IG not configured" });
  }

  const sb = createServiceClient();

  // Flag gate — silently exit until George flips it.
  const flag = await readSetting(sb, FLAG_KEY);
  if (flag !== "true") {
    return NextResponse.json({ skipped: "fleet_posts_disabled" });
  }

  // ROBERTO 2026-04-22 fix — fleet yachts are prime assets and only
  // go live Tue/Wed/Thu inside 18:00–19:30 Athens. Guard also enforces
  // the 1/day + 18h gap rules shared with the generic publish route.
  const gate = await assertPublishAllowed({ postType: "fleet_yacht" });
  if (!gate.allowed) {
    return NextResponse.json({
      skipped: "window_guard",
      reason: gate.reason,
      detail: gate.detail,
    });
  }

  // Phase A rate limit + jitter.
  if (!(await checkRateLimitHealth("post_publish"))) {
    return NextResponse.json({ skipped: "rate_limit" });
  }
  await applyPublishJitter();

  // Per-week cap.
  const capRaw = await readSetting(sb, PER_WEEK_CAP_KEY);
  const cap = capRaw ? Number(capRaw) : DEFAULT_PER_WEEK;
  const postsThisWeek = await countFleetPostsSince(sb, 7 * 86400000);
  if (postsThisWeek >= cap) {
    return NextResponse.json({
      skipped: "weekly_cap",
      postsThisWeek,
      cap,
    });
  }

  // Fetch pool.
  const pool = await fetchFleetPool();
  if (pool.length === 0) {
    await sendTelegram("⚠ Fleet post cron: Sanity pool is empty (or all yachts have <6 images).");
    return NextResponse.json({ error: "empty pool" });
  }

  // Rotation select.
  const state = await loadRotationState();
  const yacht = selectNextYacht(pool, state);
  if (!yacht) {
    await sendTelegram("⚠ Fleet post cron: no eligible yacht found (all on cooldown or zero valid angles).");
    return NextResponse.json({ error: "no eligible yacht" });
  }
  const angle = selectAngle(yacht, state);
  if (!angle) {
    await sendTelegram(`⚠ Fleet post cron: no eligible angle for ${yacht.name}.`);
    return NextResponse.json({ error: "no eligible angle" });
  }

  // Generate caption.
  let captionBody: string;
  try {
    captionBody = await generateFleetCaption(yacht, angle);
    if (!captionBody || captionBody.length < 40) {
      captionBody = fallbackFleetCaption(yacht, angle);
    }
  } catch {
    captionBody = fallbackFleetCaption(yacht, angle);
  }

  // Phase A banned hashtag strip on the prose before we attach the
  // canonical fleet hashtag block.
  {
    const { cleaned, stripped } = await stripBannedHashtags(captionBody);
    captionBody = cleaned;
    if (stripped.length > 0) {
      await sendTelegram(
        `⚠ Stripped banned hashtags from fleet prose (${yacht.name}): ${stripped.join(" ")}`,
      );
    }
  }

  const caption = `${captionBody}\n\n${fleetHashtagBlock(yacht)}`;

  // Phase F — voice audit (banned fillers + emoji policy). Alert only,
  // never blocks the publish. If this fires repeatedly for the same
  // phrase, tighten the prompt in fleet-caption.ts.
  {
    const audit = captionVoiceAudit(captionBody);
    const notes: string[] = [];
    if (audit.bannedPhrases.length > 0) {
      notes.push(`filler phrases: ${audit.bannedPhrases.join(", ")}`);
    }
    if (audit.emojiViolations.length > 0) {
      notes.push(`emoji violations: ${audit.emojiViolations.join(" ")}`);
    }
    if (notes.length > 0) {
      await sendTelegram(
        `⚠ Voice audit flag (${yacht.name} · ${angle}) — ${notes.join(" · ")}. Publishing anyway.`,
      );
    }
  }

  // Phase B similarity check — alert only (fail-open, we still publish).
  {
    const sim = await isCaptionTooSimilar(caption);
    if (sim.similar) {
      await sendTelegram(
        `⚠ Fleet caption similarity flag (${yacht.name} · ${angle}) — ${sim.reason ?? "n/a"}. Publishing anyway.`,
      );
    }
  }

  // 2026-04-28 — default flipped to FULL AUTO per George's directive
  // ("σήμερα 6 η ώρα να ποστάρει"). Set
  // settings.fleet_auto_publish_without_approval = 'false' to restore
  // the approval gate.
  const approvalFlag = await readSetting(sb, "fleet_auto_publish_without_approval");
  if (approvalFlag === "false") {
    const { enqueuePendingApproval } = await import("@/lib/caption-approval-gate");
    // Schedule for the next Tue/Wed/Thu 18:30 Athens window. The
    // approval webhook flips status to 'scheduled', then the regular
    // publish cron fires it.
    const next1830Athens = (() => {
      const now = new Date();
      for (let i = 0; i < 8; i++) {
        const cand = new Date(now.getTime() + i * 86400000);
        const weekday = Number(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: "Europe/Athens",
            weekday: "short",
          })
            .formatToParts(cand)
            .find((p) => p.type === "weekday")?.value === "Tue" ? 2
          : 0
        );
        const wd = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Athens",
          weekday: "short",
        })
          .formatToParts(cand)
          .find((p) => p.type === "weekday")?.value;
        const wdMap: Record<string, number> = { Tue: 2, Wed: 3, Thu: 4 };
        if (wd && wd in wdMap && (i > 0 || weekday > 0)) {
          const athensYmd = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Athens",
          }).format(cand);
          // 18:30 Athens = 15:30 UTC in summer DST. Build ISO from
          // Athens date + "T15:30:00.000Z" — the constraint check in
          // the DB does its own AT TIME ZONE conversion, so exact
          // summer/winter offset isn't critical for scheduling intent.
          return `${athensYmd}T15:30:00.000Z`;
        }
      }
      return new Date().toISOString();
    })();

    const { id } = await enqueuePendingApproval({
      image_url: (yacht.images?.[0]?.url as string) ?? "",
      caption,
      schedule_time: next1830Athens,
      scheduled_for: next1830Athens,
      post_type: "fleet_yacht",
    });
    return NextResponse.json({
      skipped: "approval_gate",
      id,
      yacht: yacht.name,
      angle,
      scheduled_for: next1830Athens,
    });
  }

  // Build carousel from Sanity photos. Instagram max: 10.
  const photos = (yacht.images ?? [])
    .map((img) => img.url)
    .filter((u) => typeof u === "string" && u.length > 10)
    .slice(0, 8);
  if (photos.length < 4) {
    await sendTelegram(
      `⚠ Fleet post skipped — ${yacht.name} has only ${photos.length} usable images (need ≥4).`,
    );
    return NextResponse.json({ error: "not enough photos" });
  }

  try {
    // Step 1 — create individual carousel item containers.
    const childIds: string[] = [];
    for (const url of photos) {
      const res = await fetch(`https://graph.instagram.com/v21.0/${igId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: url,
          is_carousel_item: true,
          access_token: igToken,
        }),
      });
      const data = await res.json();
      if (data.id) childIds.push(data.id);
      await new Promise((r) => setTimeout(r, 800));
    }
    if (childIds.length < 2) {
      await sendTelegram(`❌ Fleet post failed — could not create enough carousel items for ${yacht.name}.`);
      return NextResponse.json({ error: "carousel items failed" });
    }

    // Step 2 — carousel container.
    const carouselRes = await fetch(`https://graph.instagram.com/v21.0/${igId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "CAROUSEL",
        children: childIds,
        caption,
        access_token: igToken,
      }),
    });
    const carouselData = await carouselRes.json();
    if (!carouselData.id) {
      const err = carouselData.error?.message || "carousel container failed";
      await sendTelegram(`❌ Fleet carousel container failed for ${yacht.name}: ${err}`);
      return NextResponse.json({ error: err });
    }

    // Step 3 — wait for processing (carousels take ~20-40s).
    let ready = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await fetch(
        `https://graph.instagram.com/v21.0/${carouselData.id}?fields=status_code&access_token=${encodeURIComponent(igToken)}`,
      );
      const statusData = await statusRes.json();
      if (statusData.status_code === "FINISHED") {
        ready = true;
        break;
      }
      if (statusData.status_code === "ERROR") break;
    }
    if (!ready) {
      return NextResponse.json({ error: "carousel processing timeout" });
    }

    // Step 4 — publish.
    const publishRes = await fetch(`https://graph.instagram.com/v21.0/${igId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: carouselData.id,
        access_token: igToken,
      }),
    });
    const publishData = await publishRes.json();
    if (!publishData.id) {
      const err = publishData.error?.message || "publish failed";
      await sendTelegram(`❌ Fleet carousel publish failed for ${yacht.name}: ${err}`);
      return NextResponse.json({ error: err });
    }

    // ── Success path ──
    const utmUrl = buildFleetUTM(yacht, angle);

    // Log into ig_posts for analytics coverage. PostgREST builder
    // doesn't expose .catch(), so we swallow errors with try/catch.
    try {
      await sb.from("ig_posts").insert({
        image_url: photos[0],
        caption,
        status: "published",
        ig_media_id: publishData.id,
        published_at: new Date().toISOString(),
        schedule_time: new Date().toISOString(),
        metadata: {
          kind: "fleet",
          sanity_yacht_id: yacht._id,
          yacht_name: yacht.name,
          angle,
          utm_url: utmUrl,
          photos_count: photos.length,
          fleet_tier: yacht.fleetTier,
        },
      });
    } catch {}

    // Log into settings KV for the fleet_post_% index (rotation + cap counting).
    try {
      await sb.from("settings").insert({
        key: `fleet_post_${publishData.id}`,
        value: JSON.stringify({
          sanity_yacht_id: yacht._id,
          yacht_name: yacht.name,
          fleet_tier: yacht.fleetTier,
          angle,
          ig_media_id: publishData.id,
          utm_url: utmUrl,
          photos_count: photos.length,
          posted_at: new Date().toISOString(),
        }),
        updated_at: new Date().toISOString(),
      });
    } catch {}

    // Update rotation state.
    const nextState = updateStateAfterPost(state, yacht._id, angle);
    await persistRotationState(nextState);

    // Rate-limit accounting.
    await logRateLimitAction("post_publish", {
      media_id: publishData.id,
      kind: "fleet",
      yacht_id: yacht._id,
    });

    // Queue the same-yacht story followup for +48h (Phase D.1.5).
    // Pick a DIFFERENT photo than the first carousel slide so the
    // story isn't a literal repeat of the hero — use index 1 (second
    // image) when available, else first.
    const storyPhoto = (yacht.images?.[1]?.url ?? photos[0]) as string;
    await queueStoryFollowup(sb, {
      yachtId: yacht._id,
      yachtName: yacht.name,
      fireAt: new Date(Date.now() + STORY_FOLLOWUP_DELAY_MS).toISOString(),
      photoUrl: storyPhoto,
      angle,
    });

    // Post-facto Telegram summary (replaces the pre-approval gate).
    await sendTelegram(
      [
        `✅ <b>Fleet post live:</b> ${yacht.name} (angle: <code>${angle}</code>)`,
        `Carousel: ${photos.length} photos · Fleet tier: ${yacht.fleetTier ?? "n/a"}`,
        `Caption preview: "${captionBody.slice(0, 160).replace(/\n/g, " ")}..."`,
        `Link: https://instagram.com/p/${publishData.id}`,
        `UTM: boat_${(yacht.slug ?? "").toLowerCase()} · angle_${angle}`,
        ``,
        `📱 Story followup auto-queued for +48h.`,
      ].join("\n"),
    );

    return NextResponse.json({
      ok: true,
      media_id: publishData.id,
      yacht: yacht.name,
      angle,
      photos: photos.length,
      eligible_angles: eligibleAnglesForYacht(yacht),
    });
  } catch (err: any) {
    await sendTelegram(`❌ Fleet post exception (${yacht.name}): ${err?.message ?? err}`);
    return NextResponse.json({ error: err?.message ?? "unknown" });
  }
}


// Observability wrapper — records success/error/skipped/timeout
// outcomes to settings KV for the Thursday ops report.
export async function GET(...args: any[]) {
  return observeCron("instagram-fleet-post", () => (_observedImpl as any)(...args));
}
