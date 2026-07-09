// @ts-nocheck
import { NextResponse } from "next/server";
import { getGSCAccessToken } from "@/lib/google-intel";
import { getAccessToken } from "@/lib/google-api";

// Live intel for the Brand Radar arsenal — real measurements only:
//   gsc:       Google Search Console (actual position + Google page per
//              keyword, 28d vs previous 28d)
//   referrals: the site's own visitor log (CRM sessions DB) — the ONLY
//              honest window into ChatGPT/Perplexity/Copilot, since none
//              of them expose a public query API.
// Anything that cannot be fetched returns connected:false — the dashboard
// says "not connected" instead of showing fake zeros.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const GSC_SITE = process.env.GSC_SITE_URL || "https://georgeyachts.com/";
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
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GSC ${res.status}`);
  return res.json();
}

async function fetchGsc() {
  let token = await getGSCAccessToken();
  if (!token) {
    try {
      token = await getAccessToken();
    } catch {
      token = null;
    }
  }
  if (!token) return { connected: false, reason: "Re-authorize Gmail for GSC scope" };

  // GSC data lags ~3 days; compare a 28d window against the 28d before it.
  const curEnd = isoDaysAgo(3);
  const curStart = isoDaysAgo(30);
  const prevEnd = isoDaysAgo(31);
  const prevStart = isoDaysAgo(58);

  const [curQ, prevQ, curTot, prevTot, pages] = await Promise.all([
    gscQuery(token, { startDate: curStart, endDate: curEnd, dimensions: ["query"], rowLimit: 25 }),
    gscQuery(token, { startDate: prevStart, endDate: prevEnd, dimensions: ["query"], rowLimit: 100 }),
    gscQuery(token, { startDate: curStart, endDate: curEnd, dimensions: [], rowLimit: 1 }),
    gscQuery(token, { startDate: prevStart, endDate: prevEnd, dimensions: [], rowLimit: 1 }),
    gscQuery(token, { startDate: curStart, endDate: curEnd, dimensions: ["page"], rowLimit: 10 }),
  ]);

  const prevByQuery = new Map(
    (prevQ.rows ?? []).map((r) => [r.keys?.[0], r]),
  );

  const keywords = (curQ.rows ?? []).map((r) => {
    const q = r.keys?.[0] ?? "";
    const prev = prevByQuery.get(q);
    const position = Math.round((r.position ?? 0) * 10) / 10;
    return {
      query: q,
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      position,
      google_page: Math.max(1, Math.ceil(position / 10)),
      prev_position: prev ? Math.round(prev.position * 10) / 10 : null,
    };
  });

  const t = curTot.rows?.[0] ?? {};
  const p = prevTot.rows?.[0] ?? {};

  return {
    connected: true,
    window: `${curStart} → ${curEnd}`,
    totals: {
      clicks: Math.round(t.clicks ?? 0),
      impressions: Math.round(t.impressions ?? 0),
      position: Math.round((t.position ?? 0) * 10) / 10,
      prev_clicks: Math.round(p.clicks ?? 0),
      prev_impressions: Math.round(p.impressions ?? 0),
      prev_position: Math.round((p.position ?? 0) * 10) / 10,
    },
    keywords,
    pages: (pages.rows ?? []).map((r) => ({
      page: (r.keys?.[0] ?? "").replace(/^https:\/\/(www\.)?georgeyachts\.com/, "") || "/",
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      position: Math.round((r.position ?? 0) * 10) / 10,
    })),
  };
}

// The site classifies most referrers into labels ("ChatGPT", "Google
// Search"…) before writing the session row. Newer AI surfaces may still
// arrive as raw hostnames — map those here too.
const AI_LABELS = ["ChatGPT", "Perplexity", "Gemini", "Copilot", "Claude"];
const AI_HOSTS: Array<[string, string]> = [
  ["chatgpt.com", "ChatGPT"],
  ["chat.openai.com", "ChatGPT"],
  ["perplexity.ai", "Perplexity"],
  ["gemini.google.com", "Gemini"],
  ["copilot.microsoft.com", "Copilot"],
  ["claude.ai", "Claude"],
  ["you.com", "You.com"],
  ["phind.com", "Phind"],
];

function classifyAi(referrer: string | null, referrerUrl: string | null): string | null {
  if (referrer && AI_LABELS.includes(referrer)) return referrer;
  const hay = `${referrer ?? ""} ${referrerUrl ?? ""}`.toLowerCase();
  for (const [host, label] of AI_HOSTS) {
    if (hay.includes(host)) return label;
  }
  return null;
}

async function fetchReferrals() {
  const url = process.env.CRM_SUPABASE_URL;
  const key = process.env.CRM_SUPABASE_SERVICE_KEY;
  if (!url || !key) return { connected: false, reason: "CRM_SUPABASE_* env missing" };

  const since = isoDaysAgo(30);
  const res = await fetch(
    `${url}/rest/v1/sessions?select=referrer,referrer_url,started_at,is_hot_lead&started_at=gte.${since}T00:00:00&limit=10000`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    },
  );
  if (!res.ok) return { connected: false, reason: `sessions HTTP ${res.status}` };
  const rows = await res.json();

  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const channels30: Record<string, number> = {};
  const ai30: Record<string, number> = {};
  const ai7: Record<string, number> = {};
  let aiHotLeads30 = 0;
  let total7 = 0;

  for (const r of rows) {
    const label = r.referrer || "Unknown";
    channels30[label] = (channels30[label] ?? 0) + 1;
    const started = new Date(r.started_at).getTime();
    const in7 = started >= sevenDaysAgo;
    if (in7) total7++;
    const ai = classifyAi(r.referrer, r.referrer_url);
    if (ai) {
      ai30[ai] = (ai30[ai] ?? 0) + 1;
      if (in7) ai7[ai] = (ai7[ai] ?? 0) + 1;
      if (r.is_hot_lead) aiHotLeads30++;
    }
  }

  const sortDesc = (o: Record<string, number>) =>
    Object.entries(o).sort(([, a], [, b]) => b - a);

  return {
    connected: true,
    total_sessions_30d: rows.length,
    total_sessions_7d: total7,
    channels_30d: sortDesc(channels30).slice(0, 12),
    ai_30d: sortDesc(ai30),
    ai_7d: sortDesc(ai7),
    ai_hot_leads_30d: aiHotLeads30,
  };
}

export async function GET(): Promise<Response> {
  const [gsc, referrals] = await Promise.all([
    fetchGsc().catch((e) => ({ connected: false, reason: String(e?.message ?? e) })),
    fetchReferrals().catch((e) => ({ connected: false, reason: String(e?.message ?? e) })),
  ]);

  return NextResponse.json({ gsc, referrals, generated_at: new Date().toISOString() });
}
