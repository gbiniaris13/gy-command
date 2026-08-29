// @ts-nocheck
import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/google-api";
import { dfsFetch, OUR_DOMAIN, RIVALS } from "@/lib/dataforseo";

// LLM MENTIONS — which AI-answer prompts cite each of us, from
// DataForSEO's prompt database (George's order 28/8: "όλα").
//
// This replaces guesswork about AI visibility with a measured list:
// for our domain and each rival, the actual prompts whose Google AI
// answers cite them, with AI search volume per prompt. The rival
// prompts we are absent from ARE the GEO to-do list.
//
// One request per domain (multi-target is an AND, see lib/dataforseo).
// Google platform on the weekly cron (~$0.53/scan); ChatGPT platform
// only on manual refresh with ?platform=chat_gpt, to keep the burn low.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SNAP_KEY = "llm_mentions_latest";
const HIST_KEY = "llm_mentions_history";

export async function GET() {
  const [snap, hist] = await Promise.all([getSetting(SNAP_KEY), getSetting(HIST_KEY)]);
  return NextResponse.json({
    latest: snap ? JSON.parse(snap) : null,
    history: hist ? JSON.parse(hist) : [],
  });
}

export async function POST(request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") === "chat_gpt" ? "chat_gpt" : "google";
  const domains = [OUR_DOMAIN, ...RIVALS];

  const perDomain = [];
  let totalCost = 0;
  for (const domain of domains) {
    try {
      const { result, cost } = await dfsFetch("ai_optimization/llm_mentions/search/live", {
        target: [{ domain }],
        platform,
        location_code: 2840,
        language_code: "en",
        limit: 100,
        order_by: ["ai_search_volume,desc"],
      });
      totalCost += cost;
      perDomain.push({
        domain,
        total: result?.total_count ?? 0,
        prompts: (result?.items ?? []).slice(0, 40).map((i) => ({
          question: i.question,
          volume: i.ai_search_volume ?? 0,
        })),
      });
    } catch (e) {
      perDomain.push({ domain, error: String(e?.message ?? e), total: null, prompts: [] });
    }
  }

  const ours = new Set(
    (perDomain.find((d) => d.domain === OUR_DOMAIN)?.prompts ?? []).map((p) =>
      p.question?.toLowerCase(),
    ),
  );
  // The opportunity list: prompts that cite a rival and not us,
  // deduped, heaviest first.
  const oppMap = new Map();
  for (const d of perDomain) {
    if (d.domain === OUR_DOMAIN) continue;
    for (const p of d.prompts) {
      const k = p.question?.toLowerCase();
      if (!k || ours.has(k)) continue;
      const cur = oppMap.get(k) ?? { question: p.question, volume: p.volume, cited: [] };
      if (!cur.cited.includes(d.domain)) cur.cited.push(d.domain);
      oppMap.set(k, cur);
    }
  }
  const opportunities = [...oppMap.values()]
    .sort((a, b) => b.cited.length - a.cited.length || b.volume - a.volume)
    .slice(0, 30);

  const snapshot = {
    generated_at: new Date().toISOString(),
    platform,
    cost_usd: Math.round(totalCost * 1000) / 1000,
    domains: perDomain.map(({ domain, total, error }) => ({ domain, total, error })),
    our_prompts: perDomain.find((d) => d.domain === OUR_DOMAIN)?.prompts ?? [],
    opportunities,
  };
  await setSetting(SNAP_KEY, JSON.stringify(snapshot));

  const histRaw = await getSetting(HIST_KEY);
  const hist = histRaw ? JSON.parse(histRaw) : [];
  hist.push({
    at: snapshot.generated_at,
    platform,
    totals: Object.fromEntries(perDomain.map((d) => [d.domain, d.total])),
  });
  while (hist.length > 60) hist.shift();
  await setSetting(HIST_KEY, JSON.stringify(hist));

  return NextResponse.json({ ok: true, ...snapshot });
}
