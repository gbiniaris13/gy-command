"use client";

import { useEffect, useState } from "react";

interface WeeklySummary {
  share_of_voice: number;
  brand_mentions: number;
  total_queries: number;
  top_competitor: string | null;
  top_competitor_mentions: number;
  competitor_breakdown: Record<string, number>;
  week_start: string;
}

interface ScanResult {
  query: string;
  brand_mentioned: boolean;
  competitors_mentioned: string[];
  response_preview?: string;
  scan_date: string;
}

interface BrandRadarData {
  current: WeeklySummary | null;
  history: WeeklySummary[];
  brand_mentions: ScanResult[];
  all_scans: ScanResult[];
}

export default function BrandRadarClient() {
  const [data, setData] = useState<BrandRadarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    fetch("/api/analytics/brand-radar")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  async function runScan() {
    setScanning(true);
    try {
      const res = await fetch("/api/cron/brand-radar");
      const result = await res.json();
      alert(
        `Scan complete!\n\nBrand mentions: ${result.brand_mentions}/${result.scanned}\nShare of Voice: ${result.share_of_voice}\nTop competitor: ${result.top_competitor}`
      );
      // Reload data
      const updated = await fetch("/api/analytics/brand-radar").then((r) =>
        r.json()
      );
      setData(updated);
    } finally {
      setScanning(false);
    }
  }

  const current = data?.current;
  const competitorEntries = current?.competitor_breakdown
    ? Object.entries(current.competitor_breakdown)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .filter(([, v]) => (v as number) > 0)
    : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="mb-1 inline-flex rounded border border-neon-purple/30 bg-neon-purple/10 px-2 py-0.5">
            <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[3px] text-neon-purple uppercase">
              AI INTELLIGENCE
            </span>
          </div>
          <h1 className="font-[family-name:var(--font-mono)] text-lg sm:text-2xl font-black tracking-[3px] text-electric-cyan uppercase">
            BRAND RADAR
          </h1>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-muted-blue tracking-wider uppercase">
            AI VISIBILITY TRACKER — GEORGE YACHTS vs COMPETITORS
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={scanning}
          className="rounded-lg bg-neon-purple/20 border border-neon-purple/30 px-4 py-2.5 font-[family-name:var(--font-mono)] text-xs font-bold tracking-wider text-neon-purple transition-colors hover:bg-neon-purple/30 disabled:opacity-50 min-h-[44px]"
        >
          {scanning ? "SCANNING..." : "RUN SCAN NOW"}
        </button>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-32 rounded-lg bg-glass-light/20" />
          <div className="h-64 rounded-lg bg-glass-light/20" />
        </div>
      ) : !current ? (
        <div className="glass-card p-8 text-center">
          <p className="font-[family-name:var(--font-mono)] text-4xl mb-4">📡</p>
          <p className="font-[family-name:var(--font-mono)] text-sm text-muted-blue mb-2">
            NO SCAN DATA YET
          </p>
          <p className="text-xs text-muted-blue/50 mb-4">
            Run your first Brand Radar scan to see how "George Yachts" appears in AI responses
          </p>
          <button
            onClick={runScan}
            disabled={scanning}
            className="rounded-lg bg-neon-purple px-6 py-3 font-[family-name:var(--font-mono)] text-sm font-bold text-deep-space transition-colors hover:bg-neon-purple/90 disabled:opacity-50"
          >
            {scanning ? "SCANNING 25 QUERIES..." : "LAUNCH FIRST SCAN"}
          </button>
        </div>
      ) : (
        <>
          {/* Main metrics */}
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="glass-card p-4">
              <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-neon-purple/60 uppercase">
                SHARE OF VOICE
              </p>
              <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-black text-soft-white">
                {current.share_of_voice}%
              </p>
              <p className="text-[10px] text-muted-blue/50">
                George Yachts in AI responses
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-electric-cyan/60 uppercase">
                BRAND MENTIONS
              </p>
              <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-black text-soft-white">
                {current.brand_mentions}
                <span className="text-lg text-muted-blue/50">
                  /{current.total_queries}
                </span>
              </p>
              <p className="text-[10px] text-muted-blue/50">queries mentioning us</p>
            </div>
            <div className="glass-card p-4">
              <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-hot-red/60 uppercase">
                TOP COMPETITOR
              </p>
              <p className="mt-1 font-[family-name:var(--font-mono)] text-lg font-black text-soft-white truncate">
                {current.top_competitor || "—"}
              </p>
              <p className="text-[10px] text-muted-blue/50">
                {current.top_competitor_mentions} mentions
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-amber/60 uppercase">
                SCAN DATE
              </p>
              <p className="mt-1 font-[family-name:var(--font-mono)] text-lg font-bold text-soft-white">
                {new Date(current.week_start).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
              <p className="text-[10px] text-muted-blue/50">via Gemini AI</p>
            </div>
          </div>

          {/* Two columns: Competitor breakdown + Queries where we appear */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Competitor Breakdown */}
            <div className="glass-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-hot-red" />
                <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                  COMPETITOR VISIBILITY
                </h2>
              </div>

              {/* George Yachts bar */}
              <div className="mb-3 pb-3 border-b border-border-glow">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-neon-purple">
                    George Yachts (YOU)
                  </span>
                  <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-neon-purple">
                    {current.brand_mentions}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-glass-light/30">
                  <div
                    className="h-2 rounded-full bg-neon-purple"
                    style={{
                      width: `${(current.brand_mentions / current.total_queries) * 100}%`,
                    }}
                  />
                </div>
              </div>

              {/* Competitors */}
              <div className="space-y-2">
                {competitorEntries.map(([name, count]) => (
                  <div key={name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-[family-name:var(--font-mono)] text-[11px] text-soft-white">
                        {name}
                      </span>
                      <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-muted-blue">
                        {count as number}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-glass-light/30">
                      <div
                        className="h-1.5 rounded-full bg-hot-red/50"
                        style={{
                          width: `${((count as number) / current.total_queries) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                {competitorEntries.length === 0 && (
                  <p className="text-xs text-muted-blue/40 py-4 text-center">
                    No competitors mentioned in AI responses
                  </p>
                )}
              </div>
            </div>

            {/* Queries where George Yachts appears */}
            <div className="glass-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald" />
                <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                  WHERE WE APPEAR
                </h2>
              </div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {data?.brand_mentions?.map((scan, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-emerald/20 bg-emerald/5 p-2.5"
                  >
                    <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-emerald mb-1">
                      "{scan.query}"
                    </p>
                    {scan.response_preview && (
                      <p className="text-[10px] text-muted-blue/60 line-clamp-3">
                        {scan.response_preview.slice(0, 200)}...
                      </p>
                    )}
                  </div>
                ))}
                {(!data?.brand_mentions || data.brand_mentions.length === 0) && (
                  <p className="text-xs text-muted-blue/40 py-4 text-center">
                    George Yachts not yet mentioned in AI responses
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* All queries grid */}
          <div className="mt-4 glass-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber" />
              <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                ALL SCANNED QUERIES
              </h2>
              <span className="ml-auto text-[9px] text-muted-blue/40">
                {data?.all_scans?.length ?? 0} queries
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[300px] overflow-y-auto">
              {data?.all_scans?.map((scan, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-[11px] ${
                    scan.brand_mentioned
                      ? "bg-emerald/10 text-emerald"
                      : "text-muted-blue/50"
                  }`}
                >
                  <span>{scan.brand_mentioned ? "✅" : "⬜"}</span>
                  <span className="truncate">{scan.query}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
