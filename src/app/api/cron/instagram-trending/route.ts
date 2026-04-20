// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";

// Cron: every 4 hours (cadence from the brief).
//
// Feature #8 — Trending topic watcher.
//
// Scans Instagram's hashtag search API for the yacht/Greek travel
// hashtags we care about, pulls each hashtag's top_media, filters for
// posts with ≥1000 likes and published in the last 24h, and sends
// George a Telegram digest with direct links so Domingo can help him
// draft a relevant reply or inspired repost.
//
// Graceful degrade: the Instagram Graph API hashtag endpoints require
// `instagram_manage_insights` + `pages_read_engagement`. If our
// Instagram Login token doesn't have those (same failure class as
// business_discovery), we catch the error and report it in the cron
// response — publishing & the other features stay unaffected.

const HASHTAGS = [
  "YachtCharter",
  "LuxuryTravel",
  "GreekIslands",
  "Mediterranean",
  "YachtLife",
  "SuperYacht",
];

const MIN_LIKES = 1000;
const LOOKBACK_HOURS = 24;
const DEDUP_KEY_PREFIX = "ig_trending_seen:";

async function lookupHashtagId(
  igUserId: string,
  name: string,
  token: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/ig_hashtag_search?user_id=${encodeURIComponent(igUserId)}&q=${encodeURIComponent(name)}&access_token=${encodeURIComponent(token)}`
    );
    const json = await res.json();
    return json?.data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function topMedia(hashtagId: string, igUserId: string, token: string) {
  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/${hashtagId}/top_media?user_id=${encodeURIComponent(igUserId)}&fields=id,caption,like_count,comments_count,permalink,media_type,timestamp&access_token=${encodeURIComponent(token)}`
    );
    const json = await res.json();
    if (json?.error) return { error: json.error };
    return { data: Array.isArray(json?.data) ? json.data : [] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "fetch failed" };
  }
}

async function _observedImpl() {
  const token = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!token || !igId) {
    return NextResponse.json({ error: "IG not configured" }, { status: 500 });
  }

  const sb = createServiceClient();
  const cutoff = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;
  const foundViral: Array<{
    hashtag: string;
    media_id: string;
    permalink: string;
    like_count: number;
    comments_count: number;
    caption_preview: string;
    timestamp: string;
  }> = [];
  const apiErrors: Array<{ hashtag: string; reason: string }> = [];

  for (const name of HASHTAGS) {
    const hashtagId = await lookupHashtagId(igId, name, token);
    if (!hashtagId) {
      apiErrors.push({ hashtag: name, reason: "hashtag_search returned no id" });
      continue;
    }
    const media = await topMedia(hashtagId, igId, token);
    if (media.error) {
      apiErrors.push({
        hashtag: name,
        reason:
          typeof media.error === "string"
            ? media.error
            : media.error?.message ?? "top_media failed",
      });
      continue;
    }

    for (const m of media.data ?? []) {
      const likes = m.like_count ?? 0;
      const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      if (likes < MIN_LIKES || ts < cutoff) continue;
      foundViral.push({
        hashtag: name,
        media_id: m.id,
        permalink: m.permalink ?? "",
        like_count: likes,
        comments_count: m.comments_count ?? 0,
        caption_preview: (m.caption ?? "").slice(0, 120),
        timestamp: m.timestamp,
      });
    }
  }

  // If every hashtag failed with the same error (likely permission),
  // report it once and bail.
  if (foundViral.length === 0 && apiErrors.length > 0 && apiErrors.length === HASHTAGS.length) {
    const reason = apiErrors[0]?.reason ?? "all hashtag lookups failed";
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: `IG hashtag API unavailable — likely missing instagram_manage_insights permission on this token type. First error: ${reason}`,
      errors: apiErrors.slice(0, 3),
    });
  }

  if (foundViral.length === 0) {
    return NextResponse.json({
      ok: true,
      viral_found: 0,
      api_errors: apiErrors.length,
      message: "No viral matches in this window — ordinary day.",
    });
  }

  // Dedup against already-reported viral posts in the last 48h
  const seenKeys = foundViral.map((v) => DEDUP_KEY_PREFIX + v.media_id);
  const { data: existingFlags } = await sb
    .from("settings")
    .select("key, updated_at")
    .in("key", seenKeys);

  const recentKeySet = new Set(
    (existingFlags ?? [])
      .filter((f) => {
        const age = Date.now() - new Date(f.updated_at).getTime();
        return age < 48 * 60 * 60 * 1000;
      })
      .map((f) => f.key.replace(DEDUP_KEY_PREFIX, ""))
  );

  const fresh = foundViral.filter((v) => !recentKeySet.has(v.media_id));
  if (fresh.length === 0) {
    return NextResponse.json({
      ok: true,
      viral_found: foundViral.length,
      fresh: 0,
      reason: "all viral posts already reported in the last 48h",
    });
  }

  // Sort by like_count desc, cap to top 5
  const top = fresh.sort((a, b) => b.like_count - a.like_count).slice(0, 5);

  const lines = [
    "🔥 <b>Trending in yacht/travel</b>",
    `<i>${top.length} viral post${top.length > 1 ? "s" : ""} from the last ${LOOKBACK_HOURS}h with ≥${MIN_LIKES} likes across ${HASHTAGS.length} target hashtags.</i>`,
    "",
  ];
  for (const v of top) {
    lines.push(
      `• <a href="${v.permalink}">${v.like_count.toLocaleString("en-US")} likes</a> · #${v.hashtag}\n  <i>${v.caption_preview}…</i>`
    );
  }
  lines.push(
    "",
    `<i>Tell Domingo "comment on the first trending post" when you're at the Chrome to draft a reply.</i>`
  );

  await sendTelegram(lines.join("\n")).catch(() => {});

  // Dedup markers
  await sb
    .from("settings")
    .upsert(
      top.map((v) => ({
        key: DEDUP_KEY_PREFIX + v.media_id,
        value: JSON.stringify({ likes: v.like_count, seen_at: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "key" }
    )
    .catch(() => {});

  return NextResponse.json({
    ok: true,
    viral_found: foundViral.length,
    fresh_reported: top.length,
    api_errors: apiErrors.length,
    top: top.map((v) => ({
      hashtag: v.hashtag,
      likes: v.like_count,
      permalink: v.permalink,
    })),
  });
}


// Observability wrapper — records success/error/skipped/timeout
// outcomes to settings KV for the Thursday ops report.
export async function GET(...args: any[]) {
  return observeCron("instagram-trending", () => (_observedImpl as any)(...args));
}
