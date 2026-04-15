// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET() {
  const sb = createServiceClient();

  // Get latest weekly summary
  const { data: weekly } = await sb
    .from("brand_radar_weekly")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(4);

  // Get latest scan details (queries where brand was mentioned)
  const { data: mentions } = await sb
    .from("brand_radar_scans")
    .select("query, response_preview, brand_mentioned, competitors_mentioned, scan_date")
    .eq("brand_mentioned", true)
    .order("created_at", { ascending: false })
    .limit(10);

  // Get latest scan details (all queries)
  const { data: allScans } = await sb
    .from("brand_radar_scans")
    .select("query, brand_mentioned, competitors_mentioned, scan_date")
    .order("created_at", { ascending: false })
    .limit(25);

  const latest = weekly?.[0];

  return NextResponse.json({
    current: latest
      ? {
          share_of_voice: latest.share_of_voice,
          brand_mentions: latest.brand_mentions,
          total_queries: latest.total_queries,
          top_competitor: latest.top_competitor,
          top_competitor_mentions: latest.top_competitor_mentions,
          competitor_breakdown: latest.competitor_breakdown,
          week_start: latest.week_start,
        }
      : null,
    history: weekly ?? [],
    brand_mentions: mentions ?? [],
    all_scans: allScans ?? [],
  });
}
