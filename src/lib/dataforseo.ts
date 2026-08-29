// @ts-nocheck
// DataForSEO client — the one place the auth and the hard-won API
// facts live (account george@georgeyachts.com, $50 deposit 28/8).
//
// Facts that cost real money to learn, do not relearn them:
//   - LIVE endpoints accept exactly ONE task per request. A batch of
//     20 returns 19 empties with per-task 40000 and NO top-level error.
//   - llm_mentions/search with multiple targets is an AND (prompts
//     mentioning ALL of them), not an OR. One request per domain.
//   - Costs (verified 28-29/8): SERP advanced ~$0.006/query,
//     llm_mentions search ~$0.105/request, backlinks endpoints
//     ~$0.024/request, historical_serps ~$0.001, AI volumes ~$0.01.

const BASE = "https://api.dataforseo.com/v3";

export async function dfsFetch(path: string, task: Record<string, unknown>) {
  const auth = process.env.DATAFORSEO_AUTH_B64;
  if (!auth) throw new Error("DATAFORSEO_AUTH_B64 not configured");
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([task]),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`DataForSEO ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const t = data.tasks?.[0];
  if (!t || t.status_code !== 20000) {
    throw new Error(`DataForSEO task ${t?.status_code}: ${t?.status_message}`);
  }
  return { result: t.result?.[0] ?? null, cost: data.cost ?? 0 };
}

// The rivals we measure ourselves against. mygreekcharter is the
// AI-visible boutique, ionian-charter and 12knots sit above us on the
// cost SERPs, istion is the strongest Greek incumbent in our lanes.
export const OUR_DOMAIN = "georgeyachts.com";
export const RIVALS = [
  "mygreekcharter.com",
  "ionian-charter.com",
  "12knots.com",
  "istionluxuryyachts.com",
];

// Paid press-release and article-farm networks. mygreekcharter's link
// profile is stuffed with these (verified 29/8: marketminute,
// techbullion, universalpressrelease, evertise…). We NEVER buy links,
// so gap candidates from these networks are noise, not targets.
const SPAM_HINTS = [
  "pressrelease", "press-release", "newswire", "prdistribution", "prnews",
  "marketminute", "techbullion", "evertise", "digitaljournal",
  "digitalmarketreports", "topcoreidea", "ohsem", "issuewire", "openpr",
  "einpresswire", "benzinga", "streetinsider", "guestpost", "articlebiz",
  "apnews.com/press-release",
];
// Auto-generated stats directories (sitejson, statshow…) build a
// profile page for every domain on earth and link out from it. Nobody
// earned those links and Google passes no weight through them — the
// reason 12knots can hold 1,091 referring domains and still fight
// istion's 84 on the same SERPs. George spotted sitejson (rank 51)
// slipping past the rank floor on 29/8; named here so the Monday gap
// list stays a list of humans.
const AUTO_DIRECTORY_HINTS = [
  "sitejson", "statshow", "siteprice", "websiteoutlook", "siteworthtraffic",
  "hypestat", "getwebsiteworth", "websiteworth", "similarsites", "sitelike",
  "urlrating", "webstatsdomain", "statscrop", "siteindices", "sitelinks",
  "whoisology", "domaintools", "spyfu", "alexa", "rankchart",
];

export function looksLikePaidNetwork(domain: string): boolean {
  const d = (domain || "").toLowerCase();
  return SPAM_HINTS.some((h) => d.includes(h)) || AUTO_DIRECTORY_HINTS.some((h) => d.includes(h));
}
