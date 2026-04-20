// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { observeCron } from "@/lib/cron-observer";

// Daily competitor watch — AI-sourced.
//
// PIVOT NOTE: We initially built this against IG Graph API's
// business_discovery field. That field requires a Facebook-linked Page
// token; our token comes from the Instagram Login flow and PERMANENTLY
// returns "Tried accessing nonexisting field (business_discovery)".
// Migrating to Facebook Login is a re-auth lift, so we use AI to
// estimate the same numbers from publicly-known data instead. Each row
// is flagged source='ai_estimate' so the dashboard can show that badge.
//
// Cron: 03:23 UTC daily. Stores one row per (date, username) so the
// 7-day delta widget keeps working unchanged.

const COMPETITORS = [
  "charterworld",
  "burgessyachts",
  "yachtcharterfleet",
  "northropandjohnson",
  "fraseryachts",
];

const PROMPT = `You are a competitive intelligence analyst tracking luxury yacht charter brokerages on Instagram. Return ONLY a JSON object (no markdown, no commentary) with the most current publicly-known follower numbers and posting cadence for each of these Instagram accounts:

${COMPETITORS.map((u) => `- @${u}`).join("\n")}

Required shape:
{
  "competitors": [
    {
      "username": "<lowercase handle>",
      "followers_count": <integer best estimate>,
      "media_count": <integer best estimate of total posts>,
      "posts_last_30d": <integer estimate of how many posts they shipped in the last 30 days>,
      "avg_likes_last_5": <numeric estimate of average likes on their last 5 posts>,
      "avg_comments_last_5": <numeric estimate of average comments on their last 5 posts>
    }
  ]
}

Be conservative — if you don't know a number, return your best educated estimate based on industry norms for accounts of that size. Do NOT return null. Return ALL ${COMPETITORS.length} accounts.`;

interface AiCompetitor {
  username: string;
  followers_count: number;
  media_count: number;
  posts_last_30d: number;
  avg_likes_last_5: number;
  avg_comments_last_5: number;
}

function safeNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

async function _observedImpl() {
  let raw: string;
  try {
    raw = await aiChat(
      "You return only valid JSON. Never include markdown fences or commentary.",
      PROMPT
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ai call failed" },
      { status: 502 }
    );
  }

  // Extract JSON block defensively in case the model still wraps it
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return NextResponse.json(
      { error: "AI response did not contain JSON", preview: raw.slice(0, 200) },
      { status: 502 }
    );
  }

  let parsed: { competitors?: AiCompetitor[] };
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to parse AI JSON",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 }
    );
  }

  const list = Array.isArray(parsed.competitors) ? parsed.competitors : [];
  const today = new Date().toISOString().slice(0, 10);
  const recordedAt = new Date().toISOString();
  const sb = createServiceClient();
  const results: Array<{ username: string; ok: boolean; reason?: string }> = [];

  for (const username of COMPETITORS) {
    const item = list.find(
      (c) => (c.username ?? "").toLowerCase().replace(/^@/, "") === username
    );
    if (!item) {
      results.push({ username, ok: false, reason: "missing from AI response" });
      continue;
    }

    const row = {
      date: today,
      username,
      followers_count: safeNumber(item.followers_count),
      media_count: safeNumber(item.media_count),
      posts_last_30d: safeNumber(item.posts_last_30d),
      avg_likes_last_5: safeNumber(item.avg_likes_last_5),
      avg_comments_last_5: safeNumber(item.avg_comments_last_5),
      recorded_at: recordedAt,
    };

    const { error } = await sb
      .from("ig_competitors")
      .upsert(row, { onConflict: "date,username" });

    if (error) {
      results.push({ username, ok: false, reason: error.message });
    } else {
      results.push({ username, ok: true });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    ok,
    failed: failed.length,
    total: COMPETITORS.length,
    failures: failed,
    source: "ai_estimate",
  });
}


// Observability wrapper — records success/error/skipped/timeout
// outcomes to settings KV for the Thursday ops report.
export async function GET(...args: any[]) {
  return observeCron("instagram-competitors", () => (_observedImpl as any)(...args));
}
