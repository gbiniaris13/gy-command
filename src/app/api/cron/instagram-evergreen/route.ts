// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";

// Cron: 1st of every month at 07:00 UTC (10:00 Athens).
// Pulls the top-20%-engagement posts older than 6 months from
// ig_post_analytics, picks up to 4 at random, asks Gemini to rewrite
// each with a fresh angle but the same core message, and schedules
// them across the upcoming month at 15:00 UTC on days that don't
// already have a scheduled post. Library image gets swapped at
// publish time as usual.
//
// Graceful no-op when the analytics table is too sparse to justify
// a rewrite run (the feature needs data history to be useful).

const MIN_SOURCE_POSTS = 10; // Need enough signal to pick a top 20%
const REWRITE_COUNT = 4;
const PUBLISH_HOUR_UTC = 15;
const SIX_MONTHS_MS = 180 * 86400000;

const REWRITE_SYSTEM = `You rewrite Instagram captions for George Yachts. Same core message, new angle, new opening, new tone. Return only the new caption text — no JSON, no quotes, no preamble.`;

function rewriteUserPrompt(original: string): string {
  return `Rewrite this Instagram caption with a FRESH ANGLE but the SAME CORE MESSAGE. Use George Yachts BRAND voice (confident, knowledgeable, luxury without pretension). Use "we" not "I". NEVER claim personal experience or years in business. Keep length 150-300 words. Include 1 engagement question at the end. Do NOT include hashtags — they get added at publish time. Do NOT start with the same opening phrase as the original. Return ONLY the new caption text.

ORIGINAL CAPTION:
${original}`;
}

function pickSpreadDates(now: Date, count: number): Date[] {
  // Return {count} evenly spaced dates inside the next 30 days,
  // each at 15:00 UTC. Skips the first 48h so we don't clash with
  // the weekly generator that runs every Sunday.
  const out: Date[] = [];
  const base = new Date(now.getTime() + 2 * 86400000);
  const stride = Math.floor(28 / count);
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getTime() + i * stride * 86400000);
    d.setUTCHours(PUBLISH_HOUR_UTC, 0, 0, 0);
    out.push(d);
  }
  return out;
}

export async function GET() {
  const sb = createServiceClient();

  // 1. Gather signal — oldest first so we can filter > 6 months,
  //    then rank by total_interactions / reach.
  const { data: analytics, error: analyticsErr } = await sb
    .from("ig_post_analytics")
    .select("media_id, caption, published_at, reach, total_interactions");

  if (analyticsErr) {
    return NextResponse.json(
      { error: "analytics fetch failed", detail: analyticsErr.message },
      { status: 500 }
    );
  }

  const now = Date.now();
  const eligible = (analytics ?? [])
    .filter((p) => p.caption && p.published_at)
    .filter(
      (p) => now - new Date(p.published_at).getTime() >= SIX_MONTHS_MS
    )
    .map((p) => {
      const reach = Math.max(p.reach ?? 0, 1);
      const interactions = p.total_interactions ?? 0;
      return { ...p, engagement_rate: interactions / reach };
    });

  if (eligible.length < MIN_SOURCE_POSTS) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `not enough historical data yet — need ${MIN_SOURCE_POSTS} posts older than 6 months, have ${eligible.length}`,
      total_analytics_rows: analytics?.length ?? 0,
    });
  }

  // 2. Top-20% by engagement rate, then random sample of 4.
  eligible.sort((a, b) => b.engagement_rate - a.engagement_rate);
  const topCount = Math.max(REWRITE_COUNT, Math.floor(eligible.length * 0.2));
  const topPool = eligible.slice(0, topCount);
  // Shuffle + take 4
  for (let i = topPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [topPool[i], topPool[j]] = [topPool[j], topPool[i]];
  }
  const picks = topPool.slice(0, REWRITE_COUNT);

  // 3. Compute target dates and drop any day that already has a post
  const candidateDates = pickSpreadDates(new Date(now), REWRITE_COUNT);
  const windowStart = candidateDates[0].toISOString();
  const windowEnd = new Date(
    candidateDates[candidateDates.length - 1].getTime() + 86400000
  ).toISOString();

  const { data: taken } = await sb
    .from("ig_posts")
    .select("schedule_time")
    .gte("schedule_time", windowStart)
    .lte("schedule_time", windowEnd)
    .in("status", ["scheduled", "publishing", "published"]);

  const takenDays = new Set(
    (taken ?? []).map((t) => t.schedule_time.slice(0, 10))
  );
  const availableDates = candidateDates.filter(
    (d) => !takenDays.has(d.toISOString().slice(0, 10))
  );

  if (availableDates.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "every candidate day in the upcoming month already has a scheduled post",
      candidates: candidateDates.map((d) => d.toISOString()),
    });
  }

  // 4. Rewrite each pick via Gemini, in parallel, capped at available slots
  const toSchedule = picks.slice(0, availableDates.length);
  const rewritten = await Promise.all(
    toSchedule.map(async (source, i) => {
      try {
        const newCaption = await aiChat(
          REWRITE_SYSTEM,
          rewriteUserPrompt(source.caption!),
          { maxTokens: 2000 }
        );
        return {
          source_media_id: source.media_id,
          engagement_rate: source.engagement_rate,
          schedule_time: availableDates[i].toISOString(),
          caption: newCaption.trim(),
        };
      } catch (err) {
        return {
          source_media_id: source.media_id,
          engagement_rate: source.engagement_rate,
          schedule_time: availableDates[i].toISOString(),
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  const inserts = rewritten
    .filter((r) => r.caption && r.caption.length > 50)
    .map((r) => ({
      caption: r.caption,
      image_url: "",
      status: "scheduled",
      schedule_time: r.schedule_time,
    }));

  if (inserts.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        skipped: true,
        reason: "all rewrites failed or returned empty",
        errors: rewritten.filter((r) => r.error).map((r) => r.error),
      },
      { status: 502 }
    );
  }

  const { error: insertErr } = await sb.from("ig_posts").insert(inserts);
  if (insertErr) {
    return NextResponse.json(
      { error: "insert failed", detail: insertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    evergreen_scheduled: inserts.length,
    details: rewritten.map((r) => ({
      source_media_id: r.source_media_id,
      engagement_rate: r.engagement_rate,
      schedule_time: r.schedule_time,
      caption_preview: r.caption ? r.caption.slice(0, 100) : null,
      error: r.error ?? null,
    })),
  });
}
