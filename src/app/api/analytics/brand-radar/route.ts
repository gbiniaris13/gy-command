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

  // Find the latest scan_date so mentions + all_scans below are scoped
  // to a single weekly scan (not mixed across weeks). Without this scope
  // the dashboard mixes results from week N + week N-1 once a second
  // weekly scan exists, and the "queries we missed" set is wrong.
  const { data: latestScanRow } = await sb
    .from("brand_radar_scans")
    .select("scan_date")
    .order("scan_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestScanDate = latestScanRow?.scan_date ?? null;

  // Get scan details (queries where brand was mentioned) — scoped to
  // latest scan_date so the Mentions tab shows THIS week's appearances.
  const mentionsQuery = sb
    .from("brand_radar_scans")
    .select("query, response_preview, brand_mentioned, competitors_mentioned, scan_date")
    .eq("brand_mentioned", true)
    .order("created_at", { ascending: false });
  if (latestScanDate) mentionsQuery.eq("scan_date", latestScanDate);
  const { data: mentions } = await mentionsQuery.limit(50);

  // Get scan details (all queries from latest scan_date) — drives the
  // "queries we missed" grid on the Mentions tab.
  const allQuery = sb
    .from("brand_radar_scans")
    .select("query, brand_mentioned, competitors_mentioned, scan_date, response_preview")
    .order("created_at", { ascending: false });
  if (latestScanDate) allQuery.eq("scan_date", latestScanDate);
  const { data: allScans } = await allQuery.limit(500);

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
    latest_scan_date: latestScanDate,
  });
}
