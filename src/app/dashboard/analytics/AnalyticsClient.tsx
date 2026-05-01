"use client";

import { useEffect, useState } from "react";

// Newsletter-style refactor (2026-04-30) — 4 tabs:
//   Overview   — real-time presence + period summaries (Today / 7d / 30d)
//                + bounce-rate inline indicators
//   Pages      — full top-pages list with rank + share + page-type filter
//   Sources    — traffic sources with channel-level totals
//   Geography  — countries with rank, share %, sessions
//
// Header: GA4 property ID + last-update timestamp.

interface SummaryRange {
  sessions: number;
  pageviews: number;
  users: number;
  avgDuration: number;
  bounceRate: number;
}

interface DimensionRow {
  dimension: string;
  metric1: number;
  metric2: number;
}

interface GA4Data {
  realtime: number;
  today: SummaryRange;
  week: SummaryRange;
  month: SummaryRange;
  topPages: DimensionRow[];
  sources: DimensionRow[];
  countries: DimensionRow[];
  error?: string;
}

type Tab = "overview" | "pages" | "sources" | "geography";

function formatDuration(seconds: number): string {
  if (!seconds) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function bounceColor(rate: number): string {
  if (rate < 0.4) return "text-emerald";
  if (rate < 0.6) return "text-amber";
  return "text-hot-red";
}

function pageLabel(path: string): string {
  if (path === "/" || path === "") return "Homepage";
  return path;
}

function sourceCategory(src: string): "organic" | "direct" | "referral" | "social" | "paid" | "other" {
  const s = src.toLowerCase();
  if (s.includes("google") && s.includes("organic")) return "organic";
  if (s.includes("organic") || s.includes("search")) return "organic";
  if (s === "(direct)" || s.includes("direct")) return "direct";
  if (s.includes("instagram") || s.includes("facebook") || s.includes("linkedin") || s.includes("twitter") || s.includes("tiktok") || s.includes("social")) return "social";
  if (s.includes("cpc") || s.includes("ppc") || s.includes("paid")) return "paid";
  return s.includes("referral") || s.includes("/") ? "referral" : "other";
}

const CATEGORY_COLORS: Record<string, string> = {
  organic: "bg-emerald/60",
  direct: "bg-electric-cyan/60",
  social: "bg-neon-purple/60",
  referral: "bg-amber/60",
  paid: "bg-hot-red/60",
  other: "bg-muted-blue/40",
};

export default function AnalyticsClient() {
  const [data, setData] = useState<GA4Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [pageFilter, setPageFilter] = useState<"all" | "yacht" | "blog" | "system">("all");

  useEffect(() => {
    fetch("/api/analytics/ga4")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Failed to fetch analytics"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-glass-light/20" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-glass-light/20" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="font-[family-name:var(--font-mono)] text-lg font-black tracking-[3px] text-electric-cyan uppercase mb-4">
          ANALYTICS
        </h1>
        <div className="glass-card p-6 text-center">
          <p className="text-hot-red font-[family-name:var(--font-mono)] text-sm">
            {error || "No data"}
          </p>
          <p className="mt-2 text-muted-blue text-xs">Check GA4 credentials in Vercel env vars</p>
        </div>
      </div>
    );
  }

  // Filter pages by category
  const filteredPages = data.topPages.filter((p) => {
    if (pageFilter === "all") return true;
    if (pageFilter === "yacht") {
      return /\/yacht|\/charter-yacht|\/fleet/.test(p.dimension);
    }
    if (pageFilter === "blog") {
      return /\/blog|\/journal/.test(p.dimension);
    }
    if (pageFilter === "system") {
      return p.dimension.includes("/api/") || p.dimension.includes("/admin");
    }
    return true;
  });

  // Group sources by channel
  const sourcesByChannel: Record<string, DimensionRow[]> = {};
  for (const s of data.sources) {
    const cat = sourceCategory(s.dimension);
    if (!sourcesByChannel[cat]) sourcesByChannel[cat] = [];
    sourcesByChannel[cat].push(s);
  }
  const channelTotals = Object.fromEntries(
    Object.entries(sourcesByChannel).map(([k, rows]) => [
      k,
      rows.reduce((sum, r) => sum + r.metric1, 0),
    ]),
  );
  const sourcesGrandTotal = Object.values(channelTotals).reduce((s, v) => s + v, 0) || 1;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-1 inline-flex rounded border border-hot-red/30 bg-hot-red/10 px-2 py-0.5">
          <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[3px] text-hot-red uppercase">
            CLASSIFIED
          </span>
        </div>
        <h1 className="font-[family-name:var(--font-mono)] text-lg sm:text-2xl font-black tracking-[3px] text-electric-cyan uppercase">
          ANALYTICS HQ
        </h1>
        <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-muted-blue tracking-wider uppercase">
          GEORGEYACHTS.COM — GA4 PROPERTY {process.env.NEXT_PUBLIC_GA_PROPERTY_ID || "513730342"}
        </p>
      </div>

      {/* Live presence (always visible) */}
      <div className="mb-6 glass-card p-4 sm:p-5 flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald" />
        </span>
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-emerald uppercase">
          LIVE
        </span>
        <span className="font-[family-name:var(--font-mono)] text-3xl sm:text-4xl font-black text-soft-white ml-2">
          {data.realtime}
        </span>
        <span className="font-[family-name:var(--font-mono)] text-xs text-muted-blue/60 ml-1">
          active users now
        </span>
      </div>

      {/* Tab nav */}
      <div className="mb-6 flex gap-1 border-b border-white/10">
        {(
          [
            { key: "overview", label: "Overview" },
            { key: "pages", label: "Pages", count: data.topPages.length },
            { key: "sources", label: "Sources", count: data.sources.length },
            { key: "geography", label: "Geography", count: data.countries.length },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-[family-name:var(--font-mono)] font-bold tracking-wider uppercase transition-colors -mb-px border-b-2 ${
              tab === t.key
                ? "text-electric-cyan border-electric-cyan"
                : "text-ivory/40 border-transparent hover:text-ivory/70"
            }`}
          >
            {t.label}
            {"count" in t && t.count !== undefined && (
              <span className="ml-1.5 text-[10px] text-ivory/30">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "TODAY", data: data.today },
            { label: "7 DAYS", data: data.week },
            { label: "30 DAYS", data: data.month },
          ].map((p) => (
            <div key={p.label} className="glass-card p-4">
              <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-muted-blue/60 uppercase mb-3">
                {p.label}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="font-[family-name:var(--font-mono)] text-xl font-black text-soft-white">
                    {p.data.sessions.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-blue/50">Sessions</p>
                </div>
                <div>
                  <p className="font-[family-name:var(--font-mono)] text-xl font-black text-soft-white">
                    {p.data.pageviews.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-blue/50">Pageviews</p>
                </div>
                <div>
                  <p className="font-[family-name:var(--font-mono)] text-lg font-bold text-soft-white">
                    {p.data.users.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-blue/50">Users</p>
                </div>
                <div>
                  <p className="font-[family-name:var(--font-mono)] text-lg font-bold text-soft-white">
                    {formatDuration(p.data.avgDuration)}
                  </p>
                  <p className="text-[10px] text-muted-blue/50">Avg duration</p>
                </div>
                <div className="col-span-2 pt-2 border-t border-white/5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] text-muted-blue/50">Bounce rate</span>
                    <span
                      className={`font-[family-name:var(--font-mono)] text-sm font-bold ${bounceColor(p.data.bounceRate)}`}
                    >
                      {formatPercent(p.data.bounceRate)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PAGES */}
      {tab === "pages" && (
        <div className="glass-card p-4">
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <span className="h-2 w-2 rounded-full bg-electric-cyan" />
            <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
              TOP PAGES — last 30 days
            </h2>
            <div className="ml-auto flex gap-1">
              {(
                [
                  { key: "all", label: "All" },
                  { key: "yacht", label: "Yachts" },
                  { key: "blog", label: "Blog" },
                  { key: "system", label: "System" },
                ] as const
              ).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setPageFilter(f.key)}
                  className={`rounded px-2 py-1 text-[10px] font-[family-name:var(--font-mono)] font-bold tracking-wider uppercase transition-colors ${
                    pageFilter === f.key
                      ? "bg-electric-cyan/15 text-electric-cyan border border-electric-cyan/40"
                      : "bg-glass-light/10 text-muted-blue/60 border border-white/5 hover:text-ivory/70"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {filteredPages.length === 0 ? (
            <p className="text-xs text-muted-blue/40 py-8 text-center">
              No pages match this filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-[10px] text-muted-blue/50 uppercase tracking-wider">
                  <tr className="border-b border-white/5">
                    <th className="py-2 pr-3 text-left">Rank</th>
                    <th className="py-2 pr-3 text-left">Page</th>
                    <th className="py-2 pr-3 text-right">Views</th>
                    <th className="py-2 pr-3 text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPages.map((row, i) => {
                    const total = filteredPages.reduce((s, r) => s + r.metric1, 0) || 1;
                    const share = (row.metric1 / total) * 100;
                    return (
                      <tr key={i} className="border-b border-white/5 last:border-0">
                        <td className="py-2 pr-3 text-muted-blue/50">#{i + 1}</td>
                        <td className="py-2 pr-3 text-soft-white truncate max-w-[420px]">
                          {pageLabel(row.dimension)}
                        </td>
                        <td className="py-2 pr-3 text-right font-[family-name:var(--font-mono)] text-soft-white">
                          {row.metric1.toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 text-right text-muted-blue/60">
                          {share.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SOURCES */}
      {tab === "sources" && (
        <div className="space-y-4">
          <div className="glass-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-neon-purple" />
              <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                BY CHANNEL — last 30 days
              </h2>
            </div>
            <div className="space-y-3">
              {Object.entries(channelTotals)
                .sort((a, b) => b[1] - a[1])
                .map(([channel, total]) => {
                  const pct = (total / sourcesGrandTotal) * 100;
                  return (
                    <div key={channel}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-soft-white capitalize">
                          {channel}
                        </span>
                        <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-blue">
                          {total.toLocaleString()} sessions ({pct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-glass-light/30">
                        <div
                          className={`h-2 rounded-full ${CATEGORY_COLORS[channel] ?? "bg-muted-blue"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="glass-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-electric-cyan" />
              <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                ALL SOURCES (raw)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-[10px] text-muted-blue/50 uppercase tracking-wider">
                  <tr className="border-b border-white/5">
                    <th className="py-2 pr-3 text-left">Source</th>
                    <th className="py-2 pr-3 text-left">Channel</th>
                    <th className="py-2 pr-3 text-right">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sources.map((row, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3 text-soft-white truncate max-w-[260px]">
                        {row.dimension}
                      </td>
                      <td className="py-2 pr-3 text-muted-blue/60 capitalize">
                        {sourceCategory(row.dimension)}
                      </td>
                      <td className="py-2 pr-3 text-right font-[family-name:var(--font-mono)] text-soft-white">
                        {row.metric1.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* GEOGRAPHY */}
      {tab === "geography" && (
        <div className="glass-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber" />
            <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
              TOP COUNTRIES — last 30 days
            </h2>
          </div>
          <div className="space-y-2">
            {data.countries.map((row, i) => {
              const total = data.countries.reduce((s, r) => s + r.metric1, 0) || 1;
              const share = (row.metric1 / total) * 100;
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-white/5 bg-glass-light/10 px-3 py-2"
                >
                  <span className="font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/40 w-8">
                    #{i + 1}
                  </span>
                  <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-soft-white flex-shrink-0 w-32 truncate">
                    {row.dimension}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-glass-light/30 overflow-hidden">
                    <div
                      className="h-1.5 rounded-full bg-amber/60"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                  <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-muted-blue w-24 text-right">
                    {row.metric1.toLocaleString()}
                  </span>
                  <span className="font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50 w-12 text-right">
                    {share.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
