// @ts-nocheck
import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/google-api";

// SERP TRACKER — DataForSEO live Google positions with the competitors named.
//
// Why (2026-08-28, George's $50 DataForSEO deposit): Search Console only
// shows OUR rows, only when Google chose to show us, and two days late.
// It cannot answer "who overtook us on Rhodes this week". This endpoint
// asks Google's live results directly, from a US viewpoint because ~90%
// of our charterers are American, and names every domain sitting above us.
//
// GET  → the latest stored snapshot plus history (no API cost).
// POST → runs a fresh scan (live/advanced, ~$0.004 x ~20 queries ≈ $0.08),
//        stores it, appends compact history, returns it. Wired to the
//        REFRESH button on Brand Radar's Google tab and to the daily cron.
//
// Query list lives in settings.serp_tracker_queries (JSON array) so it can
// be edited without a deploy; DEFAULT_QUERIES seeds it on first run.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SNAP_KEY = "serp_tracker_latest";
const HIST_KEY = "serp_tracker_history";
const QUERIES_KEY = "serp_tracker_queries";
const OUR_DOMAIN = "georgeyachts.com";
// 2840 = United States. Our buyers search from there, so that SERP is the
// battlefield that matters, not the Greek one.
const LOCATION_CODE = 2840;

const DEFAULT_QUERIES = [
  "yacht charter greece",
  "crewed yacht charter greece",
  "luxury yacht charter greece",
  "greek yacht charter",
  "catamaran charter greece",
  "crewed catamaran charter greece",
  "power catamaran charter greece",
  "motor yacht charter greece",
  "sailing yacht charter greece",
  "superyacht charter greece",
  "yacht charter athens",
  "yacht charter mykonos",
  "yacht charter santorini",
  "yacht charter rhodes",
  "yacht charter sporades",
  "dodecanese yacht charter",
  "cyclades yacht charter",
  "how much does it cost to charter a yacht in greece",
  "yacht charter greece prices",
  "yacht charter greece with crew cost",
  // 2026-09-25: the queries of the EUR 35,000 to 80,000 a week segment
  // (Google Ads, US: private 260/mo, luxury 260, greek islands 260,
  // best 50, with crew 70). "luxury yacht charter greece" was already here.
  "private yacht charter greece",
  "yacht charter greek islands",
  "luxury crewed yacht charter greece",
  "yacht charter greece with crew",
  "best yacht charter greece",
  "charter a yacht in greece",
];
// The list stored in settings on first run stays as it was, so a new
// default only reaches the tracker if it is merged in. Missing defaults
// are appended (cap 30); anything George removed from the list on
// purpose is not re-added because removals are recorded separately.
const REMOVED_KEY = "serp_tracker_removed";

async function loadQueries(): Promise<string[]> {
  const raw = await getSetting(QUERIES_KEY);
  if (raw) {
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length) {
        let removed: string[] = [];
        try {
          removed = JSON.parse((await getSetting(REMOVED_KEY)) || "[]");
        } catch {}
        const merged = [...list];
        for (const q of DEFAULT_QUERIES) {
          if (!merged.includes(q) && !removed.includes(q) && merged.length < 30) merged.push(q);
        }
        if (merged.length !== list.length) await setSetting(QUERIES_KEY, JSON.stringify(merged));
        return merged.slice(0, 30);
      }
    } catch {}
  }
  await setSetting(QUERIES_KEY, JSON.stringify(DEFAULT_QUERIES));
  return DEFAULT_QUERIES;
}

export async function GET() {
  const [snap, hist] = await Promise.all([getSetting(SNAP_KEY), getSetting(HIST_KEY)]);
  return NextResponse.json({
    latest: snap ? JSON.parse(snap) : null,
    history: hist ? JSON.parse(hist) : [],
  });
}

export async function POST() {
  const auth = process.env.DATAFORSEO_AUTH_B64;
  if (!auth) {
    return NextResponse.json({ error: "DATAFORSEO_AUTH_B64 not configured" }, { status: 200 });
  }
  const queries = await loadQueries();

  // The LIVE endpoint accepts exactly ONE task per request ("You can set
  // only one task at a time", verified 28/8 — a 20-task batch silently
  // returned 19 empty rows). So: one request per query, five in flight.
  async function scanOne(keyword) {
    const res = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        // 2026-09-25: depth 100, not 30. With 30 the tracker wrote "no
        // position" for 16 of 19 queries while we sat at 31 to 60 and
        // moved every week unseen. Same price per call.
        { keyword, location_code: LOCATION_CODE, language_code: "en", device: "desktop", depth: 100 },
      ]),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`DataForSEO ${res.status}`);
    const d = await res.json();
    return { task: d.tasks?.[0], cost: d.cost ?? 0 };
  }

  const tasks = [];
  let totalCost = 0;
  const errors = [];
  for (let i = 0; i < queries.length; i += 5) {
    const chunk = await Promise.all(
      queries.slice(i, i + 5).map((q) =>
        scanOne(q).catch((e) => ({ task: null, cost: 0, failed: q, message: String(e?.message ?? e) })),
      ),
    );
    for (const c of chunk) {
      totalCost += c.cost;
      if (c.task && c.task.status_code === 20000) tasks.push(c.task);
      else errors.push(c.failed ?? c.task?.data?.keyword ?? "unknown");
    }
  }
  const data = { tasks, cost: Math.round(totalCost * 1000) / 1000 };

  const prevRaw = await getSetting(SNAP_KEY);
  const prev = prevRaw ? JSON.parse(prevRaw) : null;
  const prevByQuery = new Map((prev?.results ?? []).map((r) => [r.query, r]));

  const results = [];
  for (const task of data.tasks ?? []) {
    const keyword = task?.data?.keyword;
    const all = task?.result?.[0]?.items ?? [];
    const items = all.filter((i) => i.type === "organic");
    const ours = items.find((i) => (i.domain || "").includes(OUR_DOMAIN));
    const position = ours ? ours.rank_absolute : null;
    const above = ours
      ? items.filter((i) => i.rank_absolute < ours.rank_absolute).map((i) => i.domain)
      : items.slice(0, 10).map((i) => i.domain);
    // 2026-09-25: Google's own AI Overview. On 25/9 it sat on top of
    // "yacht charter greece cost" and "cost to charter a yacht in greece"
    // citing georgeyachts.com twice while the organic result was #20, and
    // the cost post lost a third of its impressions that week. The
    // advanced SERP already returns it; we used to throw it away. George's
    // measure is "keep our place in the AI", so it is recorded per query.
    const aio = all.find((i) => i.type === "ai_overview");
    const aioRefs = aio
      ? [...new Set((aio.references ?? []).map((r) => r.domain).filter(Boolean))]
      : [];
    const p = prevByQuery.get(keyword);
    results.push({
      query: keyword,
      position,
      prev_position: p ? p.position : undefined,
      // Who owns the ground above us (or the whole first page when we
      // are absent) — deduped, keeps SERP order.
      above: [...new Set(above)].slice(0, 10),
      top3: items.slice(0, 3).map((i) => ({ rank: i.rank_absolute, domain: i.domain })),
      ai_overview: aio
        ? { present: true, cites_us: aioRefs.some((d) => d.includes(OUR_DOMAIN)), refs: aioRefs.slice(0, 8) }
        : { present: false, cites_us: false, refs: [] },
    });
  }
  results.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

  const found = results.filter((r) => r.position !== null);
  // found_in_top30 keeps its meaning (the digest and the dashboard read
  // it); found_in_top100 is the new floor now that the depth is 100.
  const top30 = found.filter((r) => r.position <= 30);
  const snapshot = {
    generated_at: new Date().toISOString(),
    location: "United States (desktop)",
    queries: results.length,
    found_in_top30: top30.length,
    found_in_top100: found.length,
    avg_position_when_found: top30.length
      ? Math.round((top30.reduce((s, r) => s + r.position, 0) / top30.length) * 10) / 10
      : null,
    avg_position_top100: found.length
      ? Math.round((found.reduce((s, r) => s + r.position, 0) / found.length) * 10) / 10
      : null,
    ai_overview_queries: results.filter((r) => r.ai_overview.present).length,
    ai_overview_cites_us: results.filter((r) => r.ai_overview.cites_us).length,
    cost_usd: data.cost ?? null,
    failed_queries: errors,
    results,
  };
  await setSetting(SNAP_KEY, JSON.stringify(snapshot));

  // Compact history: one row per scan, per-query positions only.
  const histRaw = await getSetting(HIST_KEY);
  const hist = histRaw ? JSON.parse(histRaw) : [];
  hist.push({
    at: snapshot.generated_at,
    positions: Object.fromEntries(results.map((r) => [r.query, r.position])),
  });
  while (hist.length > 90) hist.shift();
  await setSetting(HIST_KEY, JSON.stringify(hist));

  return NextResponse.json({ ok: true, ...snapshot });
}
