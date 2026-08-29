// @ts-nocheck
import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/google-api";
import { dfsFetch, looksLikePaidNetwork, OUR_DOMAIN, RIVALS } from "@/lib/dataforseo";

// BACKLINK GAP — the domains that link to our rivals and not to us.
//
// Authority is THE bottleneck (28/8: georgeyachts 22 links / 20
// domains against mygreekcharter's 297 referring domains) and this is
// the strongest feed the backlink engine can get: every editorial
// domain here has already said yes to a site exactly like ours.
//
// Two hygiene rules, both non-negotiable:
//   - Paid press-release networks are filtered out (mygreekcharter's
//     profile is full of them; we never buy links, so they are noise).
//   - Nothing goes into the pitch queue directly. Candidates land in
//     settings.backlink_gap_candidates; the Mac WRITER task reads
//     that list, verifies a human email address by eye per the engine
//     rules, and only then writes a pitch.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SNAP_KEY = "backlink_gap_latest";
const CAND_KEY = "backlink_gap_candidates";

async function refDomains(target) {
  const { result, cost } = await dfsFetch("backlinks/referring_domains/live", {
    target,
    limit: 500,
    order_by: ["rank,desc"],
    exclude_internal_backlinks: true,
  });
  return {
    total: result?.total_count ?? 0,
    items: (result?.items ?? []).map((i) => ({
      domain: i.domain,
      rank: i.rank ?? 0,
      backlinks: i.backlinks ?? 0,
    })),
    cost,
  };
}

export async function GET() {
  const snap = await getSetting(SNAP_KEY);
  return NextResponse.json({ latest: snap ? JSON.parse(snap) : null });
}

export async function POST() {
  let totalCost = 0;
  const ours = await refDomains(OUR_DOMAIN);
  totalCost += ours.cost;
  const ourSet = new Set(ours.items.map((i) => i.domain));

  const rivals = [];
  const gapMap = new Map();
  for (const rival of RIVALS) {
    try {
      const r = await refDomains(rival);
      totalCost += r.cost;
      rivals.push({ domain: rival, referring_domains: r.total });
      for (const i of r.items) {
        if (ourSet.has(i.domain) || looksLikePaidNetwork(i.domain)) continue;
        const cur = gapMap.get(i.domain) ?? { domain: i.domain, rank: i.rank, links_to: [] };
        cur.rank = Math.max(cur.rank, i.rank);
        if (!cur.links_to.includes(rival)) cur.links_to.push(rival);
        gapMap.set(i.domain, cur);
      }
    } catch (e) {
      rivals.push({ domain: rival, error: String(e?.message ?? e) });
    }
  }

  // Rank floor (29/8): the first run's top was rank-0 scraper
  // directories that link to everyone (booksreadr, shortenurls…).
  // A referring domain with no rank of its own passes no authority
  // and is not worth a pitch. Real targets first, by their weight.
  // Rivals' own sister properties (12knots.ru, istion.com…) are
  // competitors, not targets.
  const RIVAL_TOKENS = ["12knots", "istion", "mygreekcharter", "ionian-charter"];
  const candidates = [...gapMap.values()]
    .filter((c) => c.rank >= 15)
    .filter((c) => !RIVAL_TOKENS.some((t) => c.domain.includes(t)))
    .sort((a, b) => b.rank - a.rank || b.links_to.length - a.links_to.length)
    .slice(0, 80);

  const snapshot = {
    generated_at: new Date().toISOString(),
    cost_usd: Math.round(totalCost * 1000) / 1000,
    ours: { domain: OUR_DOMAIN, referring_domains: ours.total },
    rivals,
    candidates,
  };
  await setSetting(SNAP_KEY, JSON.stringify(snapshot));
  // The writer task's feed — replaced wholesale each run so dead
  // candidates do not accumulate.
  await setSetting(
    CAND_KEY,
    JSON.stringify({
      generated_at: snapshot.generated_at,
      note: "Domains linking to rivals, not to us, paid networks filtered. Writer verifies emails by eye; blacklist rules in the engine SKILL still apply.",
      candidates,
    }),
  );
  return NextResponse.json({ ok: true, ...snapshot });
}
