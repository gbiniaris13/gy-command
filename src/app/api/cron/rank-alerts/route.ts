// GET /api/cron/rank-alerts — Monday + Thursday. Watches the money
// keywords in Google Search Console and tells George on Telegram when
// one moves by 3+ positions (7-day average vs the previous 7 days).
// Truth-only: real GSC numbers, no estimates, silence when nothing moved.

import { NextRequest, NextResponse } from "next/server";
import { getGSCAccessToken } from "@/lib/google-intel";
import { getAccessToken } from "@/lib/google-api";

export const runtime = "nodejs";
export const maxDuration = 60;

const GSC_SITE = process.env.GSC_SITE_URL || "https://georgeyachts.com/";
const GSC_BASE = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
  GSC_SITE,
)}/searchAnalytics/query`;

// The queries that map to weekly charters — George's KPI.
const MONEY_QUERIES = [
  "yacht charter greece",
  "crewed yacht charter greece",
  "motor yacht charter greece",
  "catamaran charter greece",
  "weekly motor yacht charter greece",
  "luxury yacht charter greece",
  "yacht charter athens",
  "athens yacht charter cost",
  "dodecanese yacht charter",
  "yacht charter rhodes",
  "yacht charter crete",
  "honeymoon yacht charter greece",
];

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

async function gscPositions(token: string, start: string, end: string) {
  const res = await fetch(GSC_BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["query"], rowLimit: 500 }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GSC ${res.status}`);
  const json = await res.json();
  const map = new Map<string, { position: number; impressions: number }>();
  for (const r of json.rows ?? []) {
    map.set(r.keys[0], { position: r.position, impressions: r.impressions });
  }
  return map;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let token = await getGSCAccessToken();
  if (!token) {
    try {
      token = await getAccessToken();
    } catch {
      token = null;
    }
  }
  if (!token) return NextResponse.json({ ok: false, error: "no GSC token" }, { status: 500 });

  // GSC lags ~3 days: current week = d-10..d-3, previous = d-17..d-10.
  const [cur, prev] = await Promise.all([
    gscPositions(token, iso(10), iso(3)),
    gscPositions(token, iso(17), iso(11)),
  ]);

  const moves: string[] = [];
  for (const q of MONEY_QUERIES) {
    const c = cur.get(q);
    const p = prev.get(q);
    if (!c || !p) continue;
    if (c.impressions < 5 && p.impressions < 5) continue;
    const delta = Math.round((p.position - c.position) * 10) / 10; // + = up
    if (Math.abs(delta) >= 3) {
      const arrow = delta > 0 ? "📈" : "📉";
      moves.push(
        `${arrow} "${q}": ${Math.round(p.position * 10) / 10} → ${Math.round(c.position * 10) / 10} (${delta > 0 ? "+" : ""}${delta})`,
      );
    }
  }

  if (moves.length) {
    try {
      const { sendTelegram } = await import("@/lib/telegram");
      await sendTelegram(
        [`🎯 <b>Rank moves (7d vs prev 7d, GSC)</b>`, ...moves].join("\n"),
      );
    } catch (e) {
      console.error("[rank-alerts] telegram failed", e);
    }
  }

  return NextResponse.json({ ok: true, tracked: MONEY_QUERIES.length, moves: moves.length });
}
