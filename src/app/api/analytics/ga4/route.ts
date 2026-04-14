// @ts-nocheck
import { NextResponse } from "next/server";
import { getGA4AccessToken } from "@/lib/google-intel";
import { getAccessToken } from "@/lib/google-api";

const PROPERTY_ID = process.env.GA_PROPERTY_ID || "513730342";

async function getToken() {
  let token = await getGA4AccessToken();
  if (!token) {
    try { token = await getAccessToken(); } catch { token = null; }
  }
  return token;
}

async function runReport(token: string, body: object) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json();
}

async function runRealtimeReport(token: string) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runRealtimeReport`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      metrics: [{ name: "activeUsers" }],
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function GET() {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "GA4 not authenticated" }, { status: 401 });
  }

  try {
    const [realtime, summary, topPages, sources, countries] = await Promise.all([
      // Real-time active users
      runRealtimeReport(token),
      // Sessions + pageviews: today, 7d, 30d
      runReport(token, {
        dateRanges: [
          { startDate: "today", endDate: "today" },
          { startDate: "7daysAgo", endDate: "today" },
          { startDate: "30daysAgo", endDate: "today" },
        ],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "activeUsers" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
        ],
      }),
      // Top pages (30d)
      runReport(token, {
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "activeUsers" },
        ],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 15,
      }),
      // Traffic sources (30d)
      runReport(token, {
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [
          { name: "sessions" },
          { name: "activeUsers" },
        ],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      // Top countries (30d)
      runReport(token, {
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "country" }],
        metrics: [
          { name: "sessions" },
          { name: "activeUsers" },
        ],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
    ]);

    // Parse realtime
    const realtimeUsers = parseInt(
      realtime?.rows?.[0]?.metricValues?.[0]?.value ?? "0",
      10
    );

    // Parse summary (3 date ranges)
    const parseSummaryRange = (idx: number) => {
      const row = summary?.rows?.find(
        (r) => r.dimensionValues?.[0]?.value === `date_range_${idx}`
      ) ?? summary?.rows?.[idx];
      const vals = row?.metricValues ?? [];
      return {
        sessions: parseInt(vals[0]?.value ?? "0", 10),
        pageviews: parseInt(vals[1]?.value ?? "0", 10),
        users: parseInt(vals[2]?.value ?? "0", 10),
        avgDuration: parseFloat(vals[3]?.value ?? "0"),
        bounceRate: parseFloat(vals[4]?.value ?? "0"),
      };
    };

    // Parse dimension reports
    const parseDimensionReport = (report: any) =>
      (report?.rows ?? []).map((row: any) => ({
        dimension: row.dimensionValues?.[0]?.value ?? "",
        metric1: parseInt(row.metricValues?.[0]?.value ?? "0", 10),
        metric2: parseInt(row.metricValues?.[1]?.value ?? "0", 10),
      }));

    return NextResponse.json({
      realtime: realtimeUsers,
      today: parseSummaryRange(0),
      week: parseSummaryRange(1),
      month: parseSummaryRange(2),
      topPages: parseDimensionReport(topPages),
      sources: parseDimensionReport(sources),
      countries: parseDimensionReport(countries),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "GA4 error" },
      { status: 500 }
    );
  }
}
