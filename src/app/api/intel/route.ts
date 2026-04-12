import { NextResponse } from "next/server";
import { getGA4AccessToken, getGSCAccessToken } from "@/lib/google-intel";

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

async function fetchSeoAuthority(): Promise<IntelMetric> {
  const accessId = process.env.MOZ_ACCESS_ID;
  const secretKey = process.env.MOZ_SECRET_KEY;
  if (!accessId || !secretKey) {
    return { value: null, sub: "Set MOZ_ACCESS_ID + MOZ_SECRET_KEY", connected: false };
  }
  try {
    const auth = Buffer.from(`${accessId}:${secretKey}`).toString("base64");
    const res = await fetch("https://lsapi.seomoz.com/v2/url_metrics", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targets: ["georgeyachts.com"],
      }),
      next: { revalidate: 86400 }, // refresh every 24h (25 queries/month limit)
    });
    if (!res.ok) {
      return { value: "—", sub: `Moz ${res.status}`, connected: true };
    }
    const json = (await res.json()) as {
      results?: Array<{
        domain_authority?: number;
        page_authority?: number;
        spam_score?: number;
        root_domains_to_root_domain?: number;
      }>;
    };
    const result = json.results?.[0];
    const da = result?.domain_authority;
    const links = result?.root_domains_to_root_domain;
    return {
      value: da != null ? String(Math.round(da)) : "—",
      sub: links != null
        ? `DA · ${links.toLocaleString()} linking domains`
        : "Domain Authority",
      connected: true,
    };
  } catch {
    return { value: "—", sub: "Moz error", connected: true };
  }
}

async function fetchGA(): Promise<IntelMetric> {
  const propertyId = process.env.GA_PROPERTY_ID;
  if (!propertyId) {
    return { value: null, sub: "Set GA_PROPERTY_ID", connected: false };
  }
  if (!process.env.GA_SERVICE_ACCOUNT_JSON) {
    return { value: null, sub: "Set GA_SERVICE_ACCOUNT_JSON", connected: false };
  }
  try {
    const token = await getGA4AccessToken();
    if (!token) return { value: "—", sub: "Auth failed", connected: true };

    // Active users over the last 7 days via GA4 Data API
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
        metrics: [{ name: "activeUsers" }],
      }),
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return { value: "—", sub: `GA4 ${res.status}`, connected: true };
    }
    const json = (await res.json()) as {
      rows?: Array<{ metricValues?: Array<{ value?: string }> }>;
    };
    const raw = json.rows?.[0]?.metricValues?.[0]?.value;
    const users = raw ? parseInt(raw, 10) : 0;
    return {
      value: users.toLocaleString(),
      sub: "Active users (7d)",
      connected: true,
    };
  } catch {
    return { value: "—", sub: "GA4 error", connected: true };
  }
}

async function fetchGSC(): Promise<IntelMetric> {
  const siteUrl = process.env.GSC_SITE_URL || "sc-domain:georgeyachts.com";
  try {
    const token = await getGSCAccessToken();
    if (!token) {
      return {
        value: null,
        sub: "Reconnect Gmail (new scope)",
        connected: false,
      };
    }
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
      siteUrl
    )}/searchAnalytics/query`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: [],
        rowLimit: 1,
      }),
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return { value: "—", sub: `GSC ${res.status}`, connected: true };
    }
    const json = (await res.json()) as {
      rows?: Array<{ clicks?: number; impressions?: number }>;
    };
    const clicks = json.rows?.[0]?.clicks ?? 0;
    const impressions = json.rows?.[0]?.impressions ?? 0;
    return {
      value: Math.round(clicks).toLocaleString(),
      sub: `Clicks · ${Math.round(impressions).toLocaleString()} imprs (7d)`,
      connected: true,
    };
  } catch {
    return { value: "—", sub: "GSC error", connected: true };
  }
}

async function fetchInstagram(): Promise<IntelMetric> {
  const token = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!token || !igId) {
    return { value: null, sub: "Set IG_ACCESS_TOKEN", connected: false };
  }
  try {
    // Graph API v19 — followers_count is on the IG Business account node.
    const url = `https://graph.facebook.com/v19.0/${igId}?fields=followers_count,media_count,username&access_token=${encodeURIComponent(
      token
    )}`;
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) {
      return { value: "—", sub: `IG ${res.status}`, connected: true };
    }
    const json = (await res.json()) as {
      followers_count?: number;
      media_count?: number;
      username?: string;
    };
    const followers = json.followers_count;
    const media = json.media_count;
    const user = json.username ? `@${json.username}` : "@georgeyachts";
    return {
      value: followers != null ? followers.toLocaleString() : "—",
      sub:
        media != null
          ? `${user} · ${media} posts`
          : `${user} followers`,
      connected: true,
    };
  } catch {
    return { value: "—", sub: "IG error", connected: true };
  }
}

export async function GET() {
  const [ga, gsc, instagram, ahrefs] = await Promise.all([
    fetchGA(),
    fetchGSC(),
    fetchInstagram(),
    fetchSeoAuthority(),
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
