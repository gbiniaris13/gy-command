import { NextResponse } from "next/server";

// Intel endpoint — aggregates marketing/SEO/social metrics from external APIs.
// Each block is guarded by an env var so the widget degrades gracefully
// until you wire up the corresponding credentials.

interface IntelMetric {
  value: string | null;
  sub?: string | null;
  connected: boolean;
}

interface IntelResponse {
  ga: IntelMetric;
  gsc: IntelMetric;
  instagram: IntelMetric;
  ahrefs: IntelMetric;
  generated_at: string;
}

async function fetchAhrefs(): Promise<IntelMetric> {
  const key = process.env.AHREFS_API_KEY;
  if (!key) return { value: null, sub: "Set AHREFS_API_KEY", connected: false };
  try {
    const url =
      "https://api.ahrefs.com/v3/site-explorer/domain-rating" +
      "?target=georgeyachts.com&date=" +
      new Date().toISOString().slice(0, 10) +
      "&protocol=https";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return { value: "—", sub: "API error", connected: true };
    const json = (await res.json()) as {
      domain_rating?: { domain_rating?: number };
    };
    const dr = json.domain_rating?.domain_rating;
    return {
      value: dr != null ? String(Math.round(dr)) : "—",
      sub: "Domain Rating",
      connected: true,
    };
  } catch {
    return { value: "—", sub: "API error", connected: true };
  }
}

async function fetchGA(): Promise<IntelMetric> {
  if (!process.env.GA_PROPERTY_ID || !process.env.GA_SERVICE_ACCOUNT) {
    return { value: null, sub: "Set GA_PROPERTY_ID", connected: false };
  }
  // Wiring GA4 Data API requires OAuth/service-account flow — placeholder for now.
  return { value: "—", sub: "Active users", connected: true };
}

async function fetchGSC(): Promise<IntelMetric> {
  if (!process.env.GSC_REFRESH_TOKEN) {
    return { value: null, sub: "Set GSC_REFRESH_TOKEN", connected: false };
  }
  return { value: "—", sub: "Clicks (7d)", connected: true };
}

async function fetchInstagram(): Promise<IntelMetric> {
  const token = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!token || !igId) {
    return { value: null, sub: "Set IG_ACCESS_TOKEN", connected: false };
  }
  try {
    const url = `https://graph.facebook.com/v19.0/${igId}?fields=followers_count&access_token=${token}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return { value: "—", sub: "Followers", connected: true };
    const json = (await res.json()) as { followers_count?: number };
    return {
      value:
        json.followers_count != null ? String(json.followers_count) : "—",
      sub: "@georgeyachts followers",
      connected: true,
    };
  } catch {
    return { value: "—", sub: "API error", connected: true };
  }
}

export async function GET() {
  const [ga, gsc, instagram, ahrefs] = await Promise.all([
    fetchGA(),
    fetchGSC(),
    fetchInstagram(),
    fetchAhrefs(),
  ]);
  const payload: IntelResponse = {
    ga,
    gsc,
    instagram,
    ahrefs,
    generated_at: new Date().toISOString(),
  };
  return NextResponse.json(payload);
}
