// @ts-nocheck
import { NextResponse } from "next/server";
import { getGSCAccessToken } from "@/lib/google-intel";
import { getAccessToken } from "@/lib/google-api";

// The TRUTH CHECK behind the Google tab (George's ask, 2026-08-28).
//
// Averages lie twice on this site. First: the site-wide average position
// mixes brand queries (position 1) with commercial ones (position ~24),
// so one number hides three realities. Second, and the one that caused
// a real scare: every time Google starts showing us for NEW queries we
// enter at position 30-60, which drags the average DOWN while the site
// is actually EXPANDING. On 28/8 the average "fell" from 8.9 to 10.5 and
// the fixed-cohort check proved the same queries were flat (23.5 → 23.1)
// while 14 brand-new queries at avg position 35 did the dragging.
//
// So this endpoint compares like with like:
//   cohort   — the SAME queries present in both 7-day windows, weighted
//              by impressions. This number is comparable week over week.
//              The headline average is not.
//   clusters — queries grouped by significant token (sporades, rhodes,
//              catamaran…). A whole cluster moving together is a real
//              ranking event; one query wobbling is noise. This is what
//              caught the Sporades/Rhodes drop on 28/8.
//   fresh    — dataState "all" so the most recent (partial) days count.
//              GSC still lags ~2 days; last_data_date says so honestly.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const GSC_SITE = process.env.GSC_SITE_URL || "sc-domain:georgeyachts.com";
const GSC_BASE = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
  GSC_SITE,
)}/searchAnalytics/query`;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

async function gscQuery(token: string, body: Record<string, unknown>) {
  const res = await fetch(GSC_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ dataState: "all", ...body }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GSC ${res.status}: ${await res.text()}`);
  return res.json();
}

// Tokens that appear in nearly every query on this site carry no topic
// signal; clustering on them would glue everything into one blob.
const STOPWORDS = new Set([
  "a", "an", "the", "in", "on", "of", "for", "to", "is", "it", "do", "does",
  "how", "much", "what", "which", "with", "you", "your", "i", "and", "or",
  "yacht", "yachts", "charter", "charters", "greece", "greek",
]);

function significantTokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-zα-ωάέήίόύώϊϋ0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export async function GET() {
  let token = await getGSCAccessToken();
  if (!token) {
    try {
      token = await getAccessToken();
    } catch {
      token = null;
    }
  }
  if (!token) {
    return NextResponse.json(
      { connected: false, reason: "Re-authorize Gmail for GSC scope" },
      { status: 200 },
    );
  }

  try {
    // Two adjacent 7-day windows ending at the freshest full day GSC has.
    const curEnd = isoDaysAgo(2);
    const curStart = isoDaysAgo(8);
    const prevEnd = isoDaysAgo(9);
    const prevStart = isoDaysAgo(15);

    const [curTot, prevTot, curQ, prevQ, daily] = await Promise.all([
      gscQuery(token, { startDate: curStart, endDate: curEnd, dimensions: [] }),
      gscQuery(token, { startDate: prevStart, endDate: prevEnd, dimensions: [] }),
      gscQuery(token, { startDate: curStart, endDate: curEnd, dimensions: ["query"], rowLimit: 25000 }),
      gscQuery(token, { startDate: prevStart, endDate: prevEnd, dimensions: ["query"], rowLimit: 25000 }),
      gscQuery(token, { startDate: isoDaysAgo(15), endDate: curEnd, dimensions: ["date"], rowLimit: 20 }),
    ]);

    const cur = new Map((curQ.rows ?? []).map((r) => [r.keys[0], r]));
    const prev = new Map((prevQ.rows ?? []).map((r) => [r.keys[0], r]));

    // ── Fixed cohort: same query in both windows, real weight in both ──
    const cohortKeys = [...cur.keys()].filter(
      (k) => prev.has(k) && cur.get(k).impressions >= 5 && prev.get(k).impressions >= 5,
    );
    let up = 0, down = 0, flat = 0;
    const movers = [];
    for (const k of cohortKeys) {
      const a = prev.get(k), b = cur.get(k);
      const delta = b.position - a.position;
      if (delta <= -1) up++;
      else if (delta >= 1) down++;
      else flat++;
      movers.push({
        query: k,
        prev_position: Math.round(a.position * 10) / 10,
        position: Math.round(b.position * 10) / 10,
        prev_impressions: a.impressions,
        impressions: b.impressions,
        weight: a.impressions + b.impressions,
      });
    }
    movers.sort((a, b) => b.weight - a.weight);

    const wSum = (rows, get) =>
      rows.reduce((s, m) => s + get(m), 0);
    const cohortImpCur = wSum(movers, (m) => m.impressions) || 1;
    const cohortImpPrev = wSum(movers, (m) => m.prev_impressions) || 1;
    const cohortPosCur =
      wSum(movers, (m) => m.position * m.impressions) / cohortImpCur;
    const cohortPosPrev =
      wSum(movers, (m) => m.prev_position * m.prev_impressions) / cohortImpPrev;

    // ── Cluster check: a topic token whose queries dropped TOGETHER ──
    const clusterAgg = new Map();
    for (const m of movers) {
      for (const t of new Set(significantTokens(m.query))) {
        const c = clusterAgg.get(t) ?? { token: t, queries: 0, impCur: 0, impPrev: 0, posCur: 0, posPrev: 0 };
        c.queries += 1;
        c.impCur += m.impressions;
        c.impPrev += m.prev_impressions;
        c.posCur += m.position * m.impressions;
        c.posPrev += m.prev_position * m.prev_impressions;
        clusterAgg.set(t, c);
      }
    }
    const clusters = [...clusterAgg.values()]
      .filter((c) => c.queries >= 3 && c.impCur >= 20 && c.impPrev >= 20)
      .map((c) => ({
        token: c.token,
        queries: c.queries,
        impressions: c.impCur,
        position: Math.round((c.posCur / c.impCur) * 10) / 10,
        prev_position: Math.round((c.posPrev / c.impPrev) * 10) / 10,
      }))
      .map((c) => ({ ...c, delta: Math.round((c.position - c.prev_position) * 10) / 10 }))
      .sort((a, b) => b.delta - a.delta);
    const alerts = clusters.filter((c) => c.delta >= 3);
    const winners = clusters.filter((c) => c.delta <= -3).reverse();

    // ── Mix effect: queries Google only started showing us this week ──
    const newQueries = (curQ.rows ?? [])
      .filter((r) => !prev.has(r.keys[0]) && r.impressions >= 8)
      .map((r) => ({
        query: r.keys[0],
        impressions: r.impressions,
        position: Math.round(r.position * 10) / 10,
      }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 12);

    const t = (row) => ({
      clicks: row?.clicks ?? 0,
      impressions: row?.impressions ?? 0,
      position: Math.round((row?.position ?? 0) * 10) / 10,
    });

    return NextResponse.json({
      connected: true,
      generated_at: new Date().toISOString(),
      window: { current: `${curStart} → ${curEnd}`, previous: `${prevStart} → ${prevEnd}` },
      last_data_date: (daily.rows ?? []).slice(-1)[0]?.keys?.[0] ?? curEnd,
      totals: { current: t(curTot.rows?.[0]), previous: t(prevTot.rows?.[0]) },
      cohort: {
        queries: movers.length,
        position: Math.round(cohortPosCur * 10) / 10,
        prev_position: Math.round(cohortPosPrev * 10) / 10,
        up,
        down,
        flat,
        movers: movers.slice(0, 15),
      },
      cluster_alerts: alerts,
      cluster_winners: winners,
      new_queries: newQueries,
      daily: (daily.rows ?? []).map((r) => ({
        date: r.keys[0],
        impressions: r.impressions,
        clicks: r.clicks,
        position: Math.round(r.position * 10) / 10,
      })),
    });
  } catch (e) {
    return NextResponse.json({ connected: false, reason: String(e?.message ?? e) }, { status: 200 });
  }
}
