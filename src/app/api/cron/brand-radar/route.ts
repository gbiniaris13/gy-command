// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { BRAND, COMPETITORS, QUERIES } from "@/lib/brand-radar-queries";

// Cron: Weekly AI Brand Radar scan — Sundays at 06:00 UTC
// Sends queries to Gemini, checks if George Yachts is mentioned in responses

const SYSTEM_PROMPT = `You are a helpful AI assistant. Answer the user's question about yacht charters naturally and helpfully. Recommend specific companies, websites, or brokers when relevant. Be specific with names.`;

export async function GET() {
  const sb = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Check if already scanned today
  const { data: existing } = await sb
    .from("brand_radar_scans")
    .select("id")
    .eq("scan_date", today)
    .limit(1);

  if (existing?.length) {
    return NextResponse.json({ status: "already_scanned", date: today });
  }

  let scanned = 0;
  let brandMentions = 0;
  const competitorCounts: Record<string, number> = {};
  COMPETITORS.forEach((c) => (competitorCounts[c] = 0));

  for (const query of QUERIES) {
    try {
      // Ask Gemini the query
      const response = await aiChat(SYSTEM_PROMPT, query);
      const responseLower = response.toLowerCase();

      // Check brand mention
      const brandMentioned =
        responseLower.includes("george yachts") ||
        responseLower.includes("georgeyachts");

      if (brandMentioned) brandMentions++;

      // Check competitor mentions
      const mentionedCompetitors: string[] = [];
      const allMentioned: string[] = [];

      if (brandMentioned) allMentioned.push(BRAND);

      for (const comp of COMPETITORS) {
        if (responseLower.includes(comp.toLowerCase())) {
          mentionedCompetitors.push(comp);
          allMentioned.push(comp);
          competitorCounts[comp]++;
        }
      }

      // Store scan result
      await sb.from("brand_radar_scans").insert({
        scan_date: today,
        query,
        response_preview: response.slice(0, 500),
        brand_mentioned: brandMentioned,
        competitors_mentioned: mentionedCompetitors,
        all_brands_mentioned: allMentioned,
        model: "gemini",
      });

      scanned++;

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[Brand Radar] Failed query: "${query}"`, err);
    }
  }

  // Calculate share of voice
  const totalMentionableResponses = QUERIES.length;
  const sov = totalMentionableResponses > 0
    ? Math.round((brandMentions / totalMentionableResponses) * 10000) / 100
    : 0;

  // Find top competitor
  const topCompetitor = Object.entries(competitorCounts)
    .sort(([, a], [, b]) => b - a)[0];

  // Store weekly summary
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  await sb.from("brand_radar_weekly").insert({
    week_start: weekStart.toISOString().slice(0, 10),
    total_queries: QUERIES.length,
    brand_mentions: brandMentions,
    share_of_voice: sov,
    top_competitor: topCompetitor?.[0] || null,
    top_competitor_mentions: topCompetitor?.[1] || 0,
    competitor_breakdown: competitorCounts,
  });

  return NextResponse.json({
    scanned,
    brand_mentions: brandMentions,
    share_of_voice: `${sov}%`,
    top_competitor: topCompetitor?.[0],
    competitor_breakdown: competitorCounts,
    date: today,
  });
}
