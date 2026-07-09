// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { BRAND, COMPETITORS, QUERIES } from "@/lib/brand-radar-queries";

// On-demand Brand Radar scan — manual trigger only (George's directive
// 2026-07-09: no automatic scans, he presses Run whenever he wants).
//
// Why batches: the old /api/cron/brand-radar looped all 80 queries with a
// 1s delay inside ONE serverless invocation. Vercel killed it at ~60s,
// every scan died at query ~23-25 and the weekly rollup never got written
// (last complete rollup: 2026-05-03). This route processes a small batch
// per call and the dashboard keeps calling it until every query is done —
// progress is tracked in the DB itself, so an interrupted scan resumes
// instead of restarting.
export const maxDuration = 60;

const BATCH_SIZE = 8;

const SYSTEM_PROMPT = `You are a helpful AI assistant. Answer the user's question about yacht charters naturally and helpfully. Recommend specific companies, websites, or brokers when relevant. Be specific with names.`;

async function rollup(sb, today: string) {
  const { data: rows } = await sb
    .from("brand_radar_scans")
    .select("brand_mentioned, competitors_mentioned")
    .eq("scan_date", today);

  const scanned = rows?.length ?? 0;
  const brandMentions = (rows ?? []).filter((r) => r.brand_mentioned).length;
  const competitorCounts: Record<string, number> = {};
  COMPETITORS.forEach((c) => (competitorCounts[c] = 0));
  for (const r of rows ?? []) {
    for (const c of r.competitors_mentioned ?? []) {
      if (c in competitorCounts) competitorCounts[c]++;
    }
  }

  const sov = scanned > 0 ? Math.round((brandMentions / scanned) * 10000) / 100 : 0;
  const topCompetitor = Object.entries(competitorCounts).sort(([, a], [, b]) => b - a)[0];

  // Same Sunday-anchored week key as the legacy cron so history stays
  // one continuous series. Replace (not duplicate) the row on re-scan.
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekKey = weekStart.toISOString().slice(0, 10);

  await sb.from("brand_radar_weekly").delete().eq("week_start", weekKey);
  await sb.from("brand_radar_weekly").insert({
    week_start: weekKey,
    total_queries: scanned,
    brand_mentions: brandMentions,
    share_of_voice: sov,
    top_competitor: topCompetitor?.[0] || null,
    top_competitor_mentions: topCompetitor?.[1] || 0,
    competitor_breakdown: competitorCounts,
  });

  try {
    const { sendTelegram } = await import("@/lib/telegram");
    await sendTelegram(
      [
        `🛰️ <b>Brand Radar — scan complete</b>`,
        `Share of Voice: <b>${sov}%</b> (${brandMentions}/${scanned} queries)`,
        `Top competitor: <b>${topCompetitor?.[0] ?? "—"}</b> (${topCompetitor?.[1] ?? 0})`,
      ].join("\n"),
    );
  } catch (e) {
    console.error("[brand-radar] Telegram summary failed:", e);
  }

  return {
    complete: true,
    scanned,
    brand_mentions: brandMentions,
    share_of_voice: `${sov}%`,
    top_competitor: topCompetitor?.[0] ?? "N/A",
    top_competitor_mentions: topCompetitor?.[1] ?? 0,
    competitor_breakdown: competitorCounts,
    date: today,
  };
}

export async function POST(request: Request): Promise<Response> {
  const sb = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  let fresh = false;
  try {
    const body = await request.json();
    fresh = body?.fresh === true;
  } catch {}

  const { data: doneRows } = await sb
    .from("brand_radar_scans")
    .select("query")
    .eq("scan_date", today);
  const doneSet = new Set((doneRows ?? []).map((r) => r.query));

  // "fresh" only wipes a COMPLETED scan (re-run same day). A partial
  // scan resumes where it stopped — no Gemini quota wasted.
  if (fresh && doneSet.size >= QUERIES.length) {
    await sb.from("brand_radar_scans").delete().eq("scan_date", today);
    doneSet.clear();
  }

  const remaining = QUERIES.filter((q) => !doneSet.has(q));

  if (remaining.length === 0) {
    return NextResponse.json(await rollup(sb, today));
  }

  const batch = remaining.slice(0, BATCH_SIZE);
  let processed = 0;

  for (const query of batch) {
    try {
      const response = await aiChat(SYSTEM_PROMPT, query);
      const responseLower = response.toLowerCase();

      const brandMentioned =
        responseLower.includes("george yachts") ||
        responseLower.includes("georgeyachts");

      const mentionedCompetitors: string[] = [];
      const allMentioned: string[] = [];
      if (brandMentioned) allMentioned.push(BRAND);
      for (const comp of COMPETITORS) {
        if (responseLower.includes(comp.toLowerCase())) {
          mentionedCompetitors.push(comp);
          allMentioned.push(comp);
        }
      }

      await sb.from("brand_radar_scans").insert({
        scan_date: today,
        query,
        response_preview: response.slice(0, 500),
        brand_mentioned: brandMentioned,
        competitors_mentioned: mentionedCompetitors,
        all_brands_mentioned: allMentioned,
        model: "gemini",
      });
      processed++;
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.error(`[Brand Radar] Failed query: "${query}"`, err);
    }
  }

  const done = doneSet.size + processed;
  if (done >= QUERIES.length) {
    return NextResponse.json(await rollup(sb, today));
  }

  return NextResponse.json({
    complete: false,
    done,
    total: QUERIES.length,
  });
}
