// Visitor Intelligence engine — surfaces the previous 24h of sessions
// from the public website into the morning cockpit briefing.
//
// Reads the `sessions` table (georgeyachts.com /api/track writes to
// it on every visit) and aggregates:
//   • Visitors today + yesterday + 7d
//   • Top corporate networks (ip_company, excluding ISPs)
//   • Top attribution sources (utm_source + referrer + classifier)
//   • Top yachts viewed (premium-weighted)
//   • Hottest leads (top 3 by hot_score with score > 5)
//   • Lead-capture conversion summary
//
// The AI commentary is a single short paragraph (≤ 80 words) ranking
// the 3 hottest visitors and suggesting a concrete action. Uses the
// existing `aiChat` helper which talks to Gemini Free by default
// (free 1500 req/day quota — way over our daily need).

import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat } from "./ai";

// Network names that are consumer/mobile ISPs rather than companies.
// We strip these from "top company" lists because "Vodafone-Panafon"
// is noise — every Greek mobile visitor shows up that way.
const ISP_NEEDLES = [
  "vodafone", "cosmote", "ote", "wind", "forthnet", "nova",
  "t-mobile", "verizon", "at&t", "att", "comcast", "spectrum",
  "charter", "xfinity", "deutsche telekom", "telekom",
  "orange", "free mobile", "bouygues", "sfr",
  "telefonica", "movistar", "vodacom", "mtn",
  "google fiber", "starlink", "cloudflare", "hetzner",
  "amazon technologies", "amazon.com",  "aws", "ovh", "digitalocean",
  "linode", "akamai",
  // residential ISP cooperatives
  "tele2", "tdc", "telia", "elisa", "kpn", "ziggo",
  "comhem", "telenor",
];

function isLikelyConsumerISP(company: string | null | undefined): boolean {
  if (!company) return true;
  const c = company.toLowerCase();
  return ISP_NEEDLES.some((n) => c.includes(n));
}

export interface TopItem {
  label: string;
  count: number;
  meta?: Record<string, string | number | null>;
}

export interface HotVisitor {
  session_id: string;
  hot_score: number;
  company: string | null;
  country: string | null;
  city: string | null;
  device_tier: string | null;
  utm_source: string | null;
  yachts: string[];
  premium_views: number;
  time_on_site: number;
  active_seconds: number | null;
  is_return: boolean;
  last_cta: string | null;
  page_count: number;
  started_at: string;
  ended_at: string | null;
}

export interface VisitorIntelSummary {
  generated_at: string;
  // Daily/weekly counters
  counts: {
    yesterday: number;
    today: number;
    last_7d: number;
    hot_yesterday: number;
    leads_yesterday: number;
    return_yesterday: number;
  };
  // Top corporate networks (ISP-filtered)
  top_companies: TopItem[];
  // Top channels — UTM source, classified referrer, or "Direct"
  top_sources: TopItem[];
  // Top yachts viewed (with premium-marker)
  top_yachts: TopItem[];
  // Hot lead leaderboard (top N by hot_score)
  hot_visitors: HotVisitor[];
  // AI-generated narrative (single paragraph)
  ai_paragraph: string;
}

function startOfAthensDayUtc(d = new Date(), daysOffset = 0): Date {
  // Build "today 00:00 Athens" then return as UTC instant.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Athens",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const m = Number(parts.month);
  const day = Number(parts.day);
  const probe = new Date(Date.UTC(y, m - 1, day + daysOffset, 0, 0, 0));
  const athensOffsetMin =
    -new Date(probe.toLocaleString("en-US", { timeZone: "Europe/Athens" })).getTime() /
      60000 +
    probe.getTime() / 60000;
  return new Date(probe.getTime() - athensOffsetMin * 60000);
}

function tallyTop<T>(rows: T[], getKey: (r: T) => string | null, limit = 5): TopItem[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = (getKey(r) || "").trim();
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function classifySource(s: {
  utm_source?: string | null;
  referrer?: string | null;
}): string {
  if (s.utm_source) return s.utm_source;
  const ref = (s.referrer || "").toLowerCase();
  if (!ref || ref === "direct" || ref === "direct / bookmark") return "Direct";
  if (ref.includes("google")) return "Google";
  if (ref.includes("bing")) return "Bing";
  if (ref.includes("instagram")) return "Instagram";
  if (ref.includes("linkedin")) return "LinkedIn";
  if (ref.includes("facebook")) return "Facebook";
  if (ref.includes("tiktok")) return "TikTok";
  if (ref.includes("chatgpt") || ref.includes("openai")) return "ChatGPT";
  if (ref.includes("perplexity")) return "Perplexity";
  if (ref.includes("claude")) return "Claude";
  if (ref.includes("gemini")) return "Gemini";
  if (ref.includes("forbes")) return "Forbes";
  return ref;
}

async function generateAiParagraph(intel: Omit<VisitorIntelSummary, "ai_paragraph">) {
  // No-op if AI isn't configured — graceful degrade.
  if (!process.env.AI_API_KEY) {
    return "";
  }
  try {
    const top3 = intel.hot_visitors.slice(0, 3);
    if (top3.length === 0) {
      return "Quiet 24h. No visitor crossed the hot threshold — focus on outbound today.";
    }
    const facts = top3.map((v, i) => {
      const parts = [
        `${i + 1}.`,
        v.company ? `[${v.company}]` : "[anon]",
        v.country ? `(${[v.city, v.country].filter(Boolean).join(", ")})` : "",
        `score ${v.hot_score.toFixed(1)}`,
        v.device_tier ? `${v.device_tier} device` : "",
        v.utm_source ? `via ${v.utm_source}` : "",
        v.yachts.length > 0 ? `viewed ${v.yachts.join(" + ")}` : "no yachts",
        v.premium_views > 0 ? `(${v.premium_views} premium)` : "",
        v.is_return ? "return visitor" : "",
        v.last_cta ? `clicked ${v.last_cta}` : "",
      ].filter(Boolean);
      return parts.join(" ");
    });
    const prompt =
      `You are George Yachts' Chief of Staff. Below are last 24h's hottest website visitors.\n\n` +
      facts.join("\n") +
      `\n\nWrite ONE paragraph (max 80 words, no preamble, no bullets) ranking these 3, telling George the single most worthwhile action this morning. Be direct, in Greek if their company is European, English if US.`;
    const resp = await aiChat(
      "You are a high-signal Chief of Staff for a luxury yacht brokerage. Speak plainly. Never invent facts.",
      prompt,
      { maxTokens: 250, temperature: 0.4 },
    );
    return (resp || "").trim();
  } catch (e) {
    console.error("[visitor-intel] AI paragraph failed:", e);
    return "";
  }
}

export async function buildVisitorIntel(
  sb: SupabaseClient,
): Promise<VisitorIntelSummary> {
  const yesterdayStart = startOfAthensDayUtc(new Date(), -1).toISOString();
  const todayStart = startOfAthensDayUtc(new Date(), 0).toISOString();
  const sevenDaysAgo = startOfAthensDayUtc(new Date(), -7).toISOString();

  // ── Counts ──
  const [yesterdayRes, todayRes, weekRes, hotRes, leadRes, returnRes] = await Promise.all([
    sb
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", yesterdayStart)
      .lt("started_at", todayStart),
    sb
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", todayStart),
    sb
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", sevenDaysAgo),
    sb
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", yesterdayStart)
      .lt("started_at", todayStart)
      .eq("is_hot_lead", true),
    sb
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", yesterdayStart)
      .lt("started_at", todayStart)
      .eq("lead_captured", true),
    sb
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", yesterdayStart)
      .lt("started_at", todayStart)
      .eq("is_return_visitor", true),
  ]);

  // ── Top sources + companies + yachts: pull yesterday's rows once ──
  const { data: rows } = await sb
    .from("sessions")
    .select(
      "session_id, ip_company, ip_is_hosting, ip_is_tor, utm_source, referrer, yachts_viewed, premium_yacht_views",
    )
    .gte("started_at", yesterdayStart)
    .lt("started_at", todayStart);

  const yesterdayRows = (rows || []).filter(
    (r) => !r.ip_is_hosting && !r.ip_is_tor,
  );

  const top_companies = tallyTop(
    yesterdayRows.filter((r) => !isLikelyConsumerISP(r.ip_company)),
    (r) => r.ip_company,
    5,
  );

  const top_sources = tallyTop(
    yesterdayRows,
    (r) => classifySource({ utm_source: r.utm_source, referrer: r.referrer }),
    5,
  );

  // Yachts: flatten the JSONB array column.
  const yachtCounts = new Map<string, { count: number; premium: number }>();
  for (const r of yesterdayRows) {
    const list = Array.isArray(r.yachts_viewed) ? r.yachts_viewed : [];
    const premiumFlag = (r.premium_yacht_views || 0) > 0;
    for (const y of list) {
      const name = typeof y === "string" ? y : (y && (y as any).name) || "";
      if (!name) continue;
      const prev = yachtCounts.get(name) || { count: 0, premium: 0 };
      yachtCounts.set(name, {
        count: prev.count + 1,
        premium: prev.premium + (premiumFlag ? 1 : 0),
      });
    }
  }
  const top_yachts: TopItem[] = Array.from(yachtCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([label, v]) => ({
      label,
      count: v.count,
      meta: { premium_view_count: v.premium },
    }));

  // ── Hottest visitors: top 5 with score > 5 from yesterday ──
  const { data: hotData } = await sb
    .from("sessions")
    .select(
      "session_id, hot_score, ip_company, country, city, device_tier, utm_source, yachts_viewed, premium_yacht_views, time_on_site, active_seconds, is_return_visitor, last_cta, pages_visited, started_at, ended_at",
    )
    .gte("started_at", yesterdayStart)
    .lt("started_at", todayStart)
    .gte("hot_score", 5)
    .order("hot_score", { ascending: false })
    .limit(5);

  const hot_visitors: HotVisitor[] = (hotData || []).map((r: any) => ({
    session_id: r.session_id,
    hot_score: Number(r.hot_score) || 0,
    company: r.ip_company || null,
    country: r.country,
    city: r.city,
    device_tier: r.device_tier,
    utm_source: r.utm_source,
    yachts: (Array.isArray(r.yachts_viewed) ? r.yachts_viewed : []).map((y: any) =>
      typeof y === "string" ? y : (y && y.name) || "",
    ).filter(Boolean),
    premium_views: r.premium_yacht_views || 0,
    time_on_site: r.time_on_site || 0,
    active_seconds: r.active_seconds ?? null,
    is_return: !!r.is_return_visitor,
    last_cta: r.last_cta || null,
    page_count: Array.isArray(r.pages_visited) ? r.pages_visited.length : 0,
    started_at: r.started_at,
    ended_at: r.ended_at,
  }));

  const intelWithoutAi: Omit<VisitorIntelSummary, "ai_paragraph"> = {
    generated_at: new Date().toISOString(),
    counts: {
      yesterday: yesterdayRes.count ?? 0,
      today: todayRes.count ?? 0,
      last_7d: weekRes.count ?? 0,
      hot_yesterday: hotRes.count ?? 0,
      leads_yesterday: leadRes.count ?? 0,
      return_yesterday: returnRes.count ?? 0,
    },
    top_companies,
    top_sources,
    top_yachts,
    hot_visitors,
  };

  const ai_paragraph = await generateAiParagraph(intelWithoutAi);

  return { ...intelWithoutAi, ai_paragraph };
}

// Format the intel block for Telegram (HTML parse mode).
export function formatVisitorIntelTelegram(intel: VisitorIntelSummary): string {
  const lines: string[] = [];
  lines.push(`<b>🛰️ Visitor Intelligence — last 24h</b>`);
  lines.push(
    `Visitors: <b>${intel.counts.yesterday}</b> · Hot: <b>${intel.counts.hot_yesterday}</b> · Leads captured: <b>${intel.counts.leads_yesterday}</b> · Return: <b>${intel.counts.return_yesterday}</b>`,
  );
  lines.push(`Today so far: <b>${intel.counts.today}</b> · 7-day total: <b>${intel.counts.last_7d}</b>`);

  if (intel.top_companies.length > 0) {
    lines.push("");
    lines.push(`<b>🏢 Top companies</b> (corporate networks only)`);
    for (const c of intel.top_companies) {
      lines.push(`  • ${escapeHtml(c.label)} · ${c.count}`);
    }
  }

  if (intel.top_sources.length > 0) {
    lines.push("");
    lines.push(`<b>🔗 Top sources</b>`);
    for (const s of intel.top_sources) {
      lines.push(`  • ${escapeHtml(s.label)} · ${s.count}`);
    }
  }

  if (intel.top_yachts.length > 0) {
    lines.push("");
    lines.push(`<b>🚢 Top yachts viewed</b>`);
    for (const y of intel.top_yachts) {
      const prem = (y.meta?.premium_view_count as number) || 0;
      lines.push(`  • ${escapeHtml(y.label)} · ${y.count}${prem > 0 ? ` (${prem} premium)` : ""}`);
    }
  }

  if (intel.hot_visitors.length > 0) {
    lines.push("");
    lines.push(`<b>🔥 Hottest visitors</b>`);
    for (let i = 0; i < intel.hot_visitors.length; i++) {
      const v = intel.hot_visitors[i];
      const bits = [
        `<b>${i + 1}.</b>`,
        v.company ? escapeHtml(v.company) : "anon",
        v.country
          ? `· ${escapeHtml([v.city, v.country].filter(Boolean).join(", "))}`
          : "",
        `· score ${v.hot_score.toFixed(1)}`,
      ].filter(Boolean);
      lines.push(`  ${bits.join(" ")}`);
      const sub = [
        v.device_tier && v.device_tier !== "unknown" ? `${v.device_tier} device` : "",
        v.utm_source ? `via ${v.utm_source}` : "",
        v.is_return ? "🔁 return" : "",
        v.last_cta ? `🎯 ${v.last_cta}` : "",
      ].filter(Boolean);
      if (sub.length) lines.push(`     ${sub.join(" · ")}`);
      if (v.yachts.length > 0) {
        lines.push(
          `     🚢 ${v.yachts.slice(0, 4).map(escapeHtml).join(" · ")}${v.yachts.length > 4 ? "…" : ""}${v.premium_views > 0 ? ` (${v.premium_views} premium)` : ""}`,
        );
      }
    }
  }

  if (intel.ai_paragraph) {
    lines.push("");
    lines.push(`<b>🧠 Chief of Staff says</b>`);
    lines.push(`<i>${escapeHtml(intel.ai_paragraph)}</i>`);
  }

  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
