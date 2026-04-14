"use client";

import { useEffect, useState } from "react";

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

function formatDuration(seconds: number): string {
  if (!seconds) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export default function AnalyticsClient() {
  const [data, setData] = useState<GA4Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          <p className="text-hot-red font-[family-name:var(--font-mono)] text-sm">{error || "No data"}</p>
          <p className="mt-2 text-muted-blue text-xs">Check GA4 credentials in Vercel env vars</p>
        </div>
      </div>
    );
  }

  const periods = [
    { label: "TODAY", data: data.today },
    { label: "7 DAYS", data: data.week },
    { label: "30 DAYS", data: data.month },
  ];

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

      {/* Real-time widget */}
      <div className="mb-6 glass-card p-4 sm:p-6">
        <div className="flex items-center gap-3">
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
      </div>

      {/* Summary cards: Today / 7d / 30d */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {periods.map((p) => (
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
                <p className="text-[10px] text-muted-blue/50">Avg Duration</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Three-column layout: Top Pages | Sources | Countries */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Pages */}
        <div className="glass-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-electric-cyan" />
            <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
              TOP PAGES
            </h2>
            <span className="ml-auto text-[9px] text-muted-blue/40">30d</span>
          </div>
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {data.topPages.map((row, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-glass-light/20 transition-colors"
              >
                <span className="font-[family-name:var(--font-mono)] text-[11px] text-soft-white truncate max-w-[65%]">
                  {row.dimension === "/" ? "Homepage" : row.dimension}
                </span>
                <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-muted-blue">
                  {row.metric1.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Traffic Sources */}
        <div className="glass-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-neon-purple" />
            <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
              TRAFFIC SOURCES
            </h2>
            <span className="ml-auto text-[9px] text-muted-blue/40">30d</span>
          </div>
          <div className="space-y-2">
            {data.sources.map((row, i) => {
              const maxSessions = data.sources[0]?.metric1 || 1;
              const pct = (row.metric1 / maxSessions) * 100;
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-[family-name:var(--font-mono)] text-[11px] text-soft-white">
                      {row.dimension}
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-muted-blue">
                      {row.metric1.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-glass-light/30">
                    <div
                      className="h-1 rounded-full bg-neon-purple/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Countries */}
        <div className="glass-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber" />
            <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
              TOP COUNTRIES
            </h2>
            <span className="ml-auto text-[9px] text-muted-blue/40">30d</span>
          </div>
          <div className="space-y-2">
            {data.countries.map((row, i) => {
              const maxSessions = data.countries[0]?.metric1 || 1;
              const pct = (row.metric1 / maxSessions) * 100;
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-[family-name:var(--font-mono)] text-[11px] text-soft-white">
                      {row.dimension}
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-muted-blue">
                      {row.metric1.toLocaleString()} sessions
                    </span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-glass-light/30">
                    <div
                      className="h-1 rounded-full bg-amber/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
