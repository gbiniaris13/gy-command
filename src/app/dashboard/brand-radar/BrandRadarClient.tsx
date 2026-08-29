"use client";

import { useEffect, useState } from "react";

// Newsletter-quality refactor (2026-04-30) — 4 tabs:
//   Overview     — current SoV, weekly summary, competitor leaderboard
//   Mentions     — every query where we appeared, with full AI response
//   Competitors  — per-competitor deep-dive (which queries they own)
//   History      — last 4 weeks SoV sparkline + week-over-week movement
//
// Header keeps the [Run scan now] button + a status pill replacing
// the legacy alert() popup. Next-scheduled scan info shown explicitly.

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

interface GscKeyword {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
  google_page: number;
  prev_position: number | null;
}

interface LiveIntel {
  gsc: {
    connected: boolean;
    reason?: string;
    window?: string;
    totals?: {
      clicks: number;
      impressions: number;
      position: number;
      prev_clicks: number;
      prev_impressions: number;
      prev_position: number;
    };
    keywords?: GscKeyword[];
    pages?: { page: string; clicks: number; impressions: number; position: number }[];
  };
  referrals: {
    connected: boolean;
    reason?: string;
    total_sessions_30d?: number;
    total_sessions_7d?: number;
    channels_30d?: [string, number][];
    ai_30d?: [string, number][];
    ai_7d?: [string, number][];
    ai_hot_leads_30d?: number;
  };
}

type Tab = "overview" | "mentions" | "competitors" | "google" | "authority" | "traffic" | "history";

export default function BrandRadarClient() {
  const [data, setData] = useState<BrandRadarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null);
  const [live, setLive] = useState<LiveIntel | null>(null);

  useEffect(() => {
    fetch("/api/analytics/brand-radar")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
    fetch("/api/brand-radar/live")
      .then((r) => r.json())
      .then(setLive)
      .catch(() => {});
  }, []);

  // Batched scan: each POST runs ~8 Gemini queries and returns progress;
  // we keep calling until the server reports completion. This is what
  // fixed the old one-shot scan that died at Vercel's 60s ceiling.
  async function runScan() {
    setScanning(true);
    setStatusMsg("Starting scan…");
    try {
      let fresh = true;
      let stalls = 0;
      for (let round = 0; round < 40; round++) {
        const res = await fetch("/api/brand-radar/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fresh }),
        });
        fresh = false;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = await res.json();
        if (r.complete) {
          setStatusMsg(
            `✓ Scan complete — ${r.brand_mentions}/${r.scanned} mentions, SoV ${r.share_of_voice}, top competitor ${r.top_competitor}`,
          );
          break;
        }
        // Two stalled rounds in a row = Gemini is rate-limiting; stop
        // honestly instead of hammering. Progress is saved — a later
        // RUN SCAN resumes from where this one stopped.
        stalls = r.stalled ? stalls + 1 : 0;
        if (stalls >= 2) {
          throw new Error(`Gemini not responding at ${r.done}/${r.total} queries`);
        }
        setStatusMsg(`Scanning Gemini live… ${r.done}/${r.total} queries`);
      }
      const updated = await fetch("/api/analytics/brand-radar").then((r) => r.json());
      setData(updated);
    } catch (e) {
      setStatusMsg(
        `✗ Scan stopped: ${(e as Error).message}. Press RUN SCAN again — it resumes where it left off.`,
      );
    } finally {
      setScanning(false);
    }
  }

  const current = data?.current ?? null;
  const history = data?.history ?? [];
  const allMentions = data?.brand_mentions ?? [];
  const allScans = data?.all_scans ?? [];
  const competitorEntries: [string, number][] = current?.competitor_breakdown
    ? Object.entries(current.competitor_breakdown)
        .map(([k, v]) => [k, Number(v) || 0] as [string, number])
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
    : [];

  const sovDelta = (() => {
    if (!history || history.length < 2) return null;
    const cur = history[0]?.share_of_voice ?? 0;
    const prev = history[1]?.share_of_voice ?? 0;
    return Number((cur - prev).toFixed(1));
  })();

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
            AI VISIBILITY — GEORGE YACHTS vs COMPETITORS · MANUAL SCANS ONLY, YOU PRESS THE BUTTON
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={scanning}
          className="rounded-lg bg-neon-purple/20 border border-neon-purple/30 px-4 py-2.5 font-[family-name:var(--font-mono)] text-xs font-bold tracking-wider text-neon-purple transition-colors hover:bg-neon-purple/30 disabled:opacity-50 min-h-[44px]"
        >
          {scanning ? "SCANNING…" : "RUN SCAN NOW"}
        </button>
      </div>

      {/* Always-visible headline: average Google position (George's ask
          2026-07-09 — the ONE number he wants to find instantly) */}
      {live?.gsc?.connected && live.gsc.totals && (
        <div className="mb-4 glass-card border border-electric-cyan/30 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[3px] text-electric-cyan uppercase">
            Google Avg Position
          </span>
          <span className="font-[family-name:var(--font-mono)] text-4xl font-black text-soft-white leading-none">
            {live.gsc.totals.position}
            <DeltaBadge
              cur={live.gsc.totals.position}
              prev={live.gsc.totals.prev_position}
              invert
            />
          </span>
          <span className="text-[11px] text-muted-blue">
            page {Math.max(1, Math.ceil(live.gsc.totals.position / 10))} of Google · last 28 days ·
            was {live.gsc.totals.prev_position} the 28 days before · Search Console, real data
          </span>
          <button
            onClick={() => setTab("google")}
            className="ml-auto text-[10px] font-[family-name:var(--font-mono)] text-electric-cyan/70 hover:text-electric-cyan transition-colors uppercase tracking-wider"
          >
            per keyword →
          </button>
        </div>
      )}

      {/* Truth note — what is measured vs what cannot be */}
      <div className="mb-4 rounded-lg border border-electric-cyan/15 bg-electric-cyan/5 px-3 py-2 text-[10px] leading-relaxed text-muted-blue">
        <span className="font-bold text-electric-cyan/80 uppercase tracking-wider">Measured, not estimated: </span>
        Gemini answers (live API scan), Google positions (Search Console), and real visitors from AI
        assistants (your own traffic log). ChatGPT and Perplexity expose no public query API — their
        footprint shows truthfully in the AI TRAFFIC tab as actual visits, never as a guessed score.
      </div>

      {/* Inline status (replaces alert popup) */}
      {statusMsg && (
        <div className="mb-4 rounded-lg border border-neon-purple/20 bg-neon-purple/5 px-3 py-2 font-[family-name:var(--font-mono)] text-[11px] text-neon-purple">
          {statusMsg}
        </div>
      )}

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
            {scanning ? "SCANNING…" : "LAUNCH FIRST SCAN"}
          </button>
          {/* Google + AI traffic work even before the first Gemini scan */}
          <div className="mt-6 space-y-4 text-left">
            <GooglePanel live={live} />
            <TrafficPanel live={live} />
          </div>
        </div>
      ) : (
        <>
          {/* Tab nav */}
          <div className="mb-6 flex gap-1 border-b border-white/10">
            {(
              [
                { key: "overview", label: "Overview" },
                { key: "mentions", label: "Mentions", count: allMentions.length },
                { key: "competitors", label: "Competitors", count: competitorEntries.length },
                { key: "google", label: "Google" },
                { key: "authority", label: "Authority" },
                { key: "traffic", label: "AI Traffic" },
                { key: "history", label: "History", count: history.length },
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
            <>
              <div className="mb-6 grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="glass-card p-4">
                  <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-neon-purple/60 uppercase">
                    SHARE OF VOICE
                  </p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <p className="font-[family-name:var(--font-mono)] text-3xl font-black text-soft-white">
                      {current.share_of_voice}%
                    </p>
                    {sovDelta !== null && sovDelta !== 0 && (
                      <span
                        className={`font-[family-name:var(--font-mono)] text-[11px] font-bold ${
                          sovDelta > 0 ? "text-emerald" : "text-hot-red"
                        }`}
                      >
                        {sovDelta > 0 ? "▲" : "▼"} {Math.abs(sovDelta)} pts vs last week
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-blue/50">George Yachts in AI responses</p>
                </div>
                <div className="glass-card p-4">
                  <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-electric-cyan/60 uppercase">
                    BRAND MENTIONS
                  </p>
                  <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-black text-soft-white">
                    {current.brand_mentions}
                    <span className="text-lg text-muted-blue/50">/{current.total_queries}</span>
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

              {/* Competitor leaderboard inline (top 5) */}
              <div className="glass-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-hot-red" />
                  <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                    LEADERBOARD (this week)
                  </h2>
                  <button
                    onClick={() => setTab("competitors")}
                    className="ml-auto text-[10px] text-muted-blue/60 hover:text-electric-cyan transition-colors"
                  >
                    Full breakdown →
                  </button>
                </div>
                {/* Us row */}
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
                <div className="space-y-2">
                  {competitorEntries.slice(0, 5).map(([name, count]) => (
                    <button
                      key={name}
                      onClick={() => {
                        setSelectedCompetitor(name);
                        setTab("competitors");
                      }}
                      className="w-full text-left hover:opacity-80"
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-[family-name:var(--font-mono)] text-[11px] text-soft-white">
                          {name}
                        </span>
                        <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-muted-blue">
                          {count}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-glass-light/30">
                        <div
                          className="h-1.5 rounded-full bg-hot-red/50"
                          style={{
                            width: `${(count / current.total_queries) * 100}%`,
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* MENTIONS */}
          {tab === "mentions" && <LlmMentionsPanel />}

          {tab === "mentions" && (
            <div className="space-y-4">
              <div className="glass-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald" />
                  <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                    QUERIES WHERE WE APPEAR
                  </h2>
                  <span className="ml-auto text-[10px] text-muted-blue/40">
                    {allMentions.length} mentions
                  </span>
                </div>
                {allMentions.length === 0 ? (
                  <p className="text-xs text-muted-blue/40 py-8 text-center">
                    George Yachts not yet mentioned in AI responses this week.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {allMentions.map((scan, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-emerald/20 bg-emerald/5 p-3"
                      >
                        <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-emerald mb-1">
                          "{scan.query}"
                        </p>
                        {scan.response_preview && (
                          <p className="text-[10px] text-muted-blue/70 line-clamp-4">
                            {scan.response_preview.slice(0, 400)}…
                          </p>
                        )}
                        {scan.competitors_mentioned?.length > 1 && (
                          <p className="mt-1.5 text-[9px] text-amber/70">
                            Also mentioned alongside:{" "}
                            {scan.competitors_mentioned
                              .filter((c) => c !== "George Yachts")
                              .join(", ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Queries we missed */}
              <div className="glass-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber" />
                  <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                    QUERIES WE MISSED — content opportunities
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[300px] overflow-y-auto">
                  {allScans
                    .filter((s) => !s.brand_mentioned)
                    .map((scan, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-muted-blue/60"
                      >
                        <span>⬜</span>
                        <span className="truncate">{scan.query}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* COMPETITORS */}
          {tab === "competitors" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="glass-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-hot-red" />
                  <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                    FULL LEADERBOARD
                  </h2>
                </div>
                {competitorEntries.length === 0 ? (
                  <p className="text-xs text-muted-blue/40 py-4 text-center">
                    No competitors mentioned in AI responses
                  </p>
                ) : (
                  <div className="space-y-2">
                    {competitorEntries.map(([name, count]) => (
                      <button
                        key={name}
                        onClick={() => setSelectedCompetitor(name)}
                        className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                          selectedCompetitor === name
                            ? "border-hot-red/60 bg-hot-red/10"
                            : "border-white/5 bg-glass-light/10 hover:border-hot-red/30"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-soft-white">
                            {name}
                          </span>
                          <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-hot-red">
                            {count} / {current.total_queries}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-glass-light/30">
                          <div
                            className="h-1.5 rounded-full bg-hot-red/60"
                            style={{
                              width: `${(count / current.total_queries) * 100}%`,
                            }}
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="glass-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber" />
                  <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                    {selectedCompetitor
                      ? `WHERE ${selectedCompetitor.toUpperCase()} APPEARS`
                      : "SELECT A COMPETITOR"}
                  </h2>
                </div>
                {!selectedCompetitor ? (
                  <p className="text-xs text-muted-blue/40 py-8 text-center">
                    Click a competitor on the left to see which queries they own.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {allScans
                      .filter((s) =>
                        s.competitors_mentioned?.includes(selectedCompetitor),
                      )
                      .map((scan, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-hot-red/20 bg-hot-red/5 p-2.5"
                        >
                          <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-soft-white">
                            "{scan.query}"
                          </p>
                          {scan.brand_mentioned && (
                            <p className="mt-1 text-[9px] text-emerald/80">
                              ✓ We also appear here
                            </p>
                          )}
                        </div>
                      ))}
                    {allScans.filter((s) =>
                      s.competitors_mentioned?.includes(selectedCompetitor),
                    ).length === 0 && (
                      <p className="text-xs text-muted-blue/40 py-4 text-center">
                        Not seen in this week's scan results.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* GOOGLE (Search Console — real positions) */}
          {tab === "google" && <GooglePanel live={live} />}

          {/* AI TRAFFIC (real visitors from AI assistants) */}
          {tab === "authority" && <AuthorityTab />}

          {tab === "traffic" && <TrafficPanel live={live} />}

          {/* HISTORY */}
          {tab === "history" && (
            <div className="space-y-4">
              <div className="glass-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-electric-cyan" />
                  <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                    SHARE OF VOICE — last {history.length} weeks
                  </h2>
                </div>
                {history.length < 2 ? (
                  <p className="text-xs text-muted-blue/40 py-8 text-center">
                    Need at least 2 scans for a trend. Run scans whenever you want — each one adds a point.
                  </p>
                ) : (
                  <Sparkline data={history.slice().reverse()} />
                )}
              </div>

              {history.length > 0 && (
                <div className="glass-card p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber" />
                    <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                      WEEKLY DETAIL
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-[10px] text-muted-blue/60 uppercase tracking-wider">
                        <tr className="border-b border-white/5">
                          <th className="py-2 pr-3 text-left">Week</th>
                          <th className="py-2 pr-3 text-right">SoV</th>
                          <th className="py-2 pr-3 text-right">Mentions</th>
                          <th className="py-2 pr-3 text-right">Queries</th>
                          <th className="py-2 text-left">Top competitor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((w) => (
                          <tr
                            key={w.week_start}
                            className="border-b border-white/5 last:border-0"
                          >
                            <td className="py-2 pr-3 font-[family-name:var(--font-mono)] text-soft-white">
                              {new Date(w.week_start).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                              })}
                            </td>
                            <td className="py-2 pr-3 text-right font-[family-name:var(--font-mono)] font-bold text-neon-purple">
                              {w.share_of_voice}%
                            </td>
                            <td className="py-2 pr-3 text-right text-soft-white">
                              {w.brand_mentions}
                            </td>
                            <td className="py-2 pr-3 text-right text-muted-blue">
                              {w.total_queries}
                            </td>
                            <td className="py-2 text-muted-blue/60 truncate max-w-[180px]">
                              {w.top_competitor ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Google panel (Search Console — real positions, 28d vs prev 28d) ──────

function DeltaBadge({ cur, prev, invert }: { cur: number; prev: number | null; invert?: boolean }) {
  if (prev === null || prev === undefined || prev === 0) return null;
  const diff = Math.round((cur - prev) * 10) / 10;
  if (diff === 0) return null;
  // For positions, DOWN is good (invert). For clicks/impressions, UP is good.
  const good = invert ? diff < 0 : diff > 0;
  return (
    <span
      className={`ml-1.5 font-[family-name:var(--font-mono)] text-[10px] font-bold ${
        good ? "text-emerald" : "text-hot-red"
      }`}
    >
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff)}
    </span>
  );
}

function GooglePanel({ live }: { live: LiveIntel | null }) {
  const gsc = live?.gsc;
  if (!live) {
    return <div className="glass-card p-4 animate-pulse h-40" />;
  }
  if (!gsc?.connected) {
    return (
      <div className="glass-card p-6 text-center">
        <p className="font-[family-name:var(--font-mono)] text-xs text-hot-red mb-1">
          GOOGLE SEARCH CONSOLE NOT CONNECTED
        </p>
        <p className="text-[10px] text-muted-blue/60">{gsc?.reason ?? "Unknown error"}</p>
      </div>
    );
  }
  const t = gsc.totals!;
  return (
    <div className="space-y-4">
      <TruthPanel />
      <SerpPanel />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="glass-card p-4">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-electric-cyan/60 uppercase">
            AVG GOOGLE POSITION (28d)
          </p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-black text-soft-white">
            {t.position}
            <DeltaBadge cur={t.position} prev={t.prev_position} invert />
          </p>
          <p className="text-[10px] text-muted-blue/50">
            page {Math.max(1, Math.ceil(t.position / 10))} of Google · was {t.prev_position} the 28d before
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-emerald/60 uppercase">
            CLICKS (28d)
          </p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-black text-soft-white">
            {t.clicks.toLocaleString()}
            <DeltaBadge cur={t.clicks} prev={t.prev_clicks} />
          </p>
          <p className="text-[10px] text-muted-blue/50">from Google search results</p>
        </div>
        <div className="glass-card p-4">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-amber/60 uppercase">
            IMPRESSIONS (28d)
          </p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-black text-soft-white">
            {t.impressions.toLocaleString()}
            <DeltaBadge cur={t.impressions} prev={t.prev_impressions} />
          </p>
          <p className="text-[10px] text-muted-blue/50">times shown on Google</p>
        </div>
      </div>

      <div className="glass-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-electric-cyan" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
            KEYWORDS — WHERE YOU ACTUALLY RANK
          </h2>
          <span className="ml-auto text-[10px] text-muted-blue/40">{gsc.window} · Search Console</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] text-muted-blue/60 uppercase tracking-wider">
              <tr className="border-b border-white/5">
                <th className="py-2 pr-3 text-left">Query</th>
                <th className="py-2 pr-3 text-right">Position</th>
                <th className="py-2 pr-3 text-right">Google page</th>
                <th className="py-2 pr-3 text-right">Clicks</th>
                <th className="py-2 text-right">Impressions</th>
              </tr>
            </thead>
            <tbody>
              {(gsc.keywords ?? []).map((k) => (
                <tr key={k.query} className="border-b border-white/5 last:border-0">
                  <td className="py-2 pr-3 font-[family-name:var(--font-mono)] text-soft-white max-w-[260px] truncate">
                    {k.query}
                  </td>
                  <td className="py-2 pr-3 text-right font-[family-name:var(--font-mono)] font-bold text-neon-purple whitespace-nowrap">
                    {k.position}
                    <DeltaBadge cur={k.position} prev={k.prev_position} invert />
                  </td>
                  <td
                    className={`py-2 pr-3 text-right font-[family-name:var(--font-mono)] font-bold ${
                      k.google_page === 1 ? "text-emerald" : k.google_page === 2 ? "text-amber" : "text-muted-blue"
                    }`}
                  >
                    {k.google_page}
                  </td>
                  <td className="py-2 pr-3 text-right text-soft-white">{k.clicks}</td>
                  <td className="py-2 text-right text-muted-blue">{k.impressions.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
            TOP PAGES ON GOOGLE
          </h2>
        </div>
        <div className="space-y-1.5">
          {(gsc.pages ?? []).map((p) => (
            <div key={p.page} className="flex items-center gap-3 text-[11px]">
              <span className="font-[family-name:var(--font-mono)] text-soft-white truncate flex-1">{p.page}</span>
              <span className="text-muted-blue whitespace-nowrap">pos {p.position}</span>
              <span className="text-emerald whitespace-nowrap w-16 text-right">{p.clicks} clicks</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── AI Traffic panel (real visitors referred by AI assistants) ────────────

function TrafficPanel({ live }: { live: LiveIntel | null }) {
  const ref = live?.referrals;
  if (!live) {
    return <div className="glass-card p-4 animate-pulse h-40" />;
  }
  if (!ref?.connected) {
    return (
      <div className="glass-card p-6 text-center">
        <p className="font-[family-name:var(--font-mono)] text-xs text-hot-red mb-1">
          VISITOR LOG NOT CONNECTED
        </p>
        <p className="text-[10px] text-muted-blue/60">{ref?.reason ?? "Unknown error"}</p>
      </div>
    );
  }
  const ai30 = ref.ai_30d ?? [];
  const ai7 = new Map(ref.ai_7d ?? []);
  const aiTotal30 = ai30.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="glass-card p-4">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-neon-purple/60 uppercase">
            VISITS FROM AI ASSISTANTS (30d)
          </p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-black text-soft-white">{aiTotal30}</p>
          <p className="text-[10px] text-muted-blue/50">
            real sessions on georgeyachts.com sent by ChatGPT, Perplexity & co
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-electric-cyan/60 uppercase">
            ALL SESSIONS (30d)
          </p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-black text-soft-white">
            {(ref.total_sessions_30d ?? 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-muted-blue/50">{ref.total_sessions_7d ?? 0} in the last 7 days</p>
        </div>
        <div className="glass-card p-4">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-hot-red/60 uppercase">
            HOT LEADS FROM AI (30d)
          </p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-black text-soft-white">
            {ref.ai_hot_leads_30d ?? 0}
          </p>
          <p className="text-[10px] text-muted-blue/50">AI-referred visitors flagged hot by the tracker</p>
        </div>
      </div>

      <div className="glass-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-neon-purple" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
            WHICH AI SENDS YOU PEOPLE
          </h2>
          <span className="ml-auto text-[10px] text-muted-blue/40">
            the honest proxy for ChatGPT/Perplexity visibility — no public API exists
          </span>
        </div>
        {ai30.length === 0 ? (
          <p className="text-xs text-muted-blue/40 py-6 text-center">
            No AI-referred visits in the last 30 days.
          </p>
        ) : (
          <div className="space-y-2">
            {ai30.map(([name, count]) => (
              <div key={name}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-[family-name:var(--font-mono)] text-[11px] font-bold text-soft-white">
                    {name}
                  </span>
                  <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-blue">
                    {count} visits (30d) · {ai7.get(name) ?? 0} last 7d
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-glass-light/30">
                  <div
                    className="h-1.5 rounded-full bg-neon-purple/70"
                    style={{ width: `${(count / Math.max(aiTotal30, 1)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-electric-cyan" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
            ALL TRAFFIC CHANNELS (30d)
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {(ref.channels_30d ?? []).map(([name, count]) => (
            <div key={name} className="flex items-center justify-between text-[11px]">
              <span className="text-soft-white truncate">{name}</span>
              <span className="font-[family-name:var(--font-mono)] text-muted-blue">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── inline SVG sparkline ───────────────────────────────────────────────────

function Sparkline({ data }: { data: WeeklySummary[] }) {
  if (data.length === 0) return null;
  const W = 600;
  const H = 120;
  const PAD = 12;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const values = data.map((d) => d.share_of_voice);
  const max = Math.max(...values, 1);
  const min = 0;
  const range = max - min || 1;
  const points = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1 || 1)) * innerW;
    const y = PAD + innerH - ((d.share_of_voice - min) / range) * innerH;
    return { x, y, w: d };
  });
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    `M ${points[0].x.toFixed(1)} ${(H - PAD).toFixed(1)} ` +
    points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") +
    ` L ${points[points.length - 1].x.toFixed(1)} ${(H - PAD).toFixed(1)} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32">
        <defs>
          <linearGradient id="brand-radar-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(187 110 255 / 0.4)" />
            <stop offset="100%" stopColor="rgb(187 110 255 / 0)" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#brand-radar-grad)" />
        <path d={linePath} fill="none" stroke="rgb(187 110 255)" strokeWidth="2" />
        {points.map((p) => (
          <circle key={p.w.week_start} cx={p.x} cy={p.y} r="3" fill="rgb(187 110 255)" />
        ))}
      </svg>
      <div className="flex justify-between text-[9px] text-muted-blue/40 mt-1">
        {points.map((p, i) => (
          <span key={i}>
            {new Date(p.w.week_start).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Truth panel (fixed-cohort GSC check — same queries, both weeks) ───────
//
// Why this exists (2026-08-28): the headline average position mixes brand,
// guides and commercial queries, and it DROPS every time Google starts
// showing the site for brand-new queries (they enter at position 30-60).
// George read one of those dips as "we are falling to page two". The fix
// is methodological, not cosmetic: compare only the queries present in
// BOTH weeks, weighted by impressions, and group them into topic clusters
// so a real event (all Sporades queries dropping together) is separated
// from noise (one query wobbling) and from expansion (new queries at 35+).
interface TruthData {
  connected: boolean;
  reason?: string;
  window?: { current: string; previous: string };
  last_data_date?: string;
  totals?: {
    current: { clicks: number; impressions: number; position: number };
    previous: { clicks: number; impressions: number; position: number };
  };
  cohort?: {
    queries: number;
    position: number;
    prev_position: number;
    up: number;
    down: number;
    flat: number;
    movers: {
      query: string;
      position: number;
      prev_position: number;
      impressions: number;
      prev_impressions: number;
    }[];
  };
  cluster_alerts?: { token: string; queries: number; impressions: number; position: number; prev_position: number; delta: number }[];
  cluster_winners?: { token: string; queries: number; impressions: number; position: number; prev_position: number; delta: number }[];
  new_queries?: { query: string; impressions: number; position: number }[];
}

function TruthPanel() {
  const [truth, setTruth] = useState<TruthData | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const r = await fetch("/api/brand-radar/truth", { cache: "no-store" });
      setTruth(await r.json());
    } catch (e) {
      setTruth({ connected: false, reason: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!truth) {
    return <div className="glass-card p-4 animate-pulse h-32" />;
  }
  if (!truth.connected) {
    return (
      <div className="glass-card p-4 text-center">
        <p className="font-[family-name:var(--font-mono)] text-xs text-hot-red">
          TRUTH CHECK UNAVAILABLE — {truth.reason ?? "unknown"}
        </p>
      </div>
    );
  }

  const c = truth.cohort!;
  const cohortDelta = Math.round((c.position - c.prev_position) * 10) / 10;
  const alerts = truth.cluster_alerts ?? [];
  const winners = truth.cluster_winners ?? [];
  const fresh = truth.new_queries ?? [];

  return (
    <div className="glass-card p-4 border border-electric-cyan/25">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-electric-cyan animate-pulse" />
        <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
          TRUTH CHECK — SAME QUERIES, BOTH WEEKS
        </h2>
        <button
          onClick={refresh}
          disabled={busy}
          className="ml-auto rounded border border-electric-cyan/30 bg-electric-cyan/10 px-3 py-1.5 font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-wider text-electric-cyan uppercase hover:bg-electric-cyan/20 disabled:opacity-50"
        >
          {busy ? "CHECKING…" : "REFRESH"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-electric-cyan/60 uppercase">
            FIXED-COHORT POSITION
          </p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-black text-soft-white">
            {c.position}
            <span
              className={`ml-2 text-xs font-bold ${
                cohortDelta < 0 ? "text-emerald" : cohortDelta > 0 ? "text-hot-red" : "text-muted-blue"
              }`}
            >
              {cohortDelta === 0 ? "flat" : `${cohortDelta > 0 ? "▼" : "▲"} ${Math.abs(cohortDelta)}`}
            </span>
          </p>
          <p className="text-[10px] text-muted-blue/60">
            was {c.prev_position} last week · {c.queries} identical queries · the ONLY number
            comparable week to week
          </p>
        </div>
        <div>
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-emerald/60 uppercase">
            QUERY MOVEMENT
          </p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-lg font-black">
            <span className="text-emerald">▲ {c.up}</span>
            <span className="text-hot-red ml-3">▼ {c.down}</span>
            <span className="text-muted-blue ml-3">· {c.flat} flat</span>
          </p>
          <p className="text-[10px] text-muted-blue/60">of the same {c.queries} queries</p>
        </div>
        <div>
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-amber/60 uppercase">
            EXPANSION (drags the average, is GOOD)
          </p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-lg font-black text-soft-white">
            {fresh.length} new queries
          </p>
          <p className="text-[10px] text-muted-blue/60">
            Google started showing us for these this week — they enter deep and pull the
            headline average down while the site expands
          </p>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="mb-3 rounded-lg border border-hot-red/30 bg-hot-red/10 p-3">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-hot-red uppercase mb-2">
            ⚠ REAL DROPS — WHOLE TOPIC MOVED TOGETHER
          </p>
          {alerts.map((a) => (
            <div key={a.token} className="flex items-center gap-3 text-[11px] py-0.5">
              <span className="font-[family-name:var(--font-mono)] font-bold text-soft-white uppercase">{a.token}</span>
              <span className="text-muted-blue">{a.queries} queries · {a.impressions} impr</span>
              <span className="ml-auto font-[family-name:var(--font-mono)] text-hot-red font-bold">
                {a.prev_position} → {a.position}
              </span>
            </div>
          ))}
        </div>
      )}
      {alerts.length === 0 && (
        <p className="mb-3 text-[11px] text-emerald/80 font-[family-name:var(--font-mono)]">
          ✓ No topic cluster dropped this week. Single-query wobbles are noise, not events.
        </p>
      )}

      {winners.length > 0 && (
        <div className="mb-3 rounded-lg border border-emerald/20 bg-emerald/5 p-3">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-emerald uppercase mb-2">
            CLUSTERS RISING
          </p>
          {winners.map((a) => (
            <div key={a.token} className="flex items-center gap-3 text-[11px] py-0.5">
              <span className="font-[family-name:var(--font-mono)] font-bold text-soft-white uppercase">{a.token}</span>
              <span className="text-muted-blue">{a.queries} queries · {a.impressions} impr</span>
              <span className="ml-auto font-[family-name:var(--font-mono)] text-emerald font-bold">
                {a.prev_position} → {a.position}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-blue/50">
        Windows: {truth.window?.current} vs {truth.window?.previous} · Search Console data runs
        ~2 days behind, latest day available {truth.last_data_date}. The big “Avg Google
        Position” above mixes brand + guides + commercial queries and shifts whenever the query
        mix changes — judge the trend HERE, on identical queries.
      </p>
    </div>
  );
}

// ─── SERP tracker panel (DataForSEO — live positions with rivals named) ────
//
// 2026-08-28: bought with George's $50 DataForSEO deposit. Search Console
// shows only our own rows, two days late, and goes blind on queries where
// Google never shows us at all. This panel asks the live US-desktop SERP
// (our buyers are ~90% American) and names every domain above us, so
// "who overtook us on Rhodes" stops being a guess. REFRESH costs ~$0.08;
// a weekday cron keeps the history moving even if nobody presses it.
interface SerpResult {
  query: string;
  position: number | null;
  prev_position?: number | null;
  above: string[];
  top3: { rank: number; domain: string }[];
}

interface SerpSnapshot {
  generated_at: string;
  location: string;
  queries: number;
  found_in_top30: number;
  avg_position_when_found: number | null;
  cost_usd: number | null;
  results: SerpResult[];
}

function SerpPanel() {
  const [snap, setSnap] = useState<SerpSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/brand-radar/serp")
      .then((r) => r.json())
      .then((d) => setSnap(d.latest))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/brand-radar/serp", { method: "POST" });
      const d = await r.json();
      if (d.error) setErr(d.error);
      else setSnap(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <div className="glass-card p-4 animate-pulse h-32" />;

  return (
    <div className="glass-card p-4 border border-neon-purple/25">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-neon-purple" />
        <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-neon-purple uppercase">
          LIVE SERP — WHO SITS ABOVE US, BY NAME
        </h2>
        <button
          onClick={refresh}
          disabled={busy}
          className="ml-auto rounded border border-neon-purple/30 bg-neon-purple/10 px-3 py-1.5 font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-wider text-neon-purple uppercase hover:bg-neon-purple/20 disabled:opacity-50"
        >
          {busy ? "SCANNING GOOGLE…" : "REFRESH (~$0.08)"}
        </button>
      </div>

      {err && (
        <p className="mb-3 text-[11px] text-hot-red font-[family-name:var(--font-mono)]">✗ {err}</p>
      )}

      {!snap ? (
        <p className="text-[11px] text-muted-blue">
          No scan stored yet. Press REFRESH for the first live look at the US Google results
          for our money queries.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-blue">
            <span>
              In top 30:{" "}
              <span className="font-bold text-soft-white">
                {snap.found_in_top30}/{snap.queries}
              </span>
            </span>
            <span>
              Avg position when present:{" "}
              <span className="font-bold text-soft-white">{snap.avg_position_when_found ?? "n/a"}</span>
            </span>
            <span>{snap.location}</span>
            <span>{new Date(snap.generated_at).toLocaleString()}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] text-muted-blue/60 uppercase tracking-wider">
                <tr className="border-b border-white/5">
                  <th className="py-2 pr-3 text-left">Query</th>
                  <th className="py-2 pr-3 text-right">Us</th>
                  <th className="py-2 text-left">Ahead of us (SERP order)</th>
                </tr>
              </thead>
              <tbody>
                {snap.results.map((r) => (
                  <tr key={r.query} className="border-b border-white/5 last:border-0 align-top">
                    <td className="py-2 pr-3 font-[family-name:var(--font-mono)] text-soft-white max-w-[220px]">
                      {r.query}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      <span
                        className={`font-[family-name:var(--font-mono)] font-bold ${
                          r.position === null
                            ? "text-hot-red"
                            : r.position <= 10
                              ? "text-emerald"
                              : r.position <= 20
                                ? "text-amber"
                                : "text-muted-blue"
                        }`}
                      >
                        {r.position ?? "30+"}
                      </span>
                      <DeltaBadge cur={r.position ?? 31} prev={r.prev_position ?? null} invert />
                    </td>
                    <td className="py-2 text-muted-blue/80 text-[11px] leading-relaxed">
                      {r.above.length ? r.above.join(" · ") : <span className="text-emerald">nobody</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] text-muted-blue/50">
            Live Google, United States, desktop, top 30 organic. "30+" means we are not in the
            first three pages for that query there. A weekday morning snapshot runs automatically;
            REFRESH any time for the current picture.
          </p>
        </>
      )}
    </div>
  );
}

// ─── LLM Mentions panel (DataForSEO prompt database, 29/8) ─────────────────
//
// Which AI-answer prompts cite each of us, measured. The rival prompts
// we are absent from are the GEO to-do list, sorted by how many rivals
// share them. Weekly Sunday cron; REFRESH ~$0.55 (Google platform).
function LlmMentionsPanel() {
  const [snap, setSnap] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/brand-radar/llm-mentions")
      .then((r) => r.json())
      .then((d) => setSnap(d.latest))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/brand-radar/llm-mentions", { method: "POST" });
      const d = await r.json();
      if (d.error) setErr(d.error);
      else setSnap(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <div className="glass-card p-4 animate-pulse h-24 mb-4" />;

  return (
    <div className="glass-card p-4 border border-electric-cyan/25 mb-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-electric-cyan" />
        <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
          LLM MENTIONS — MEASURED, ALL PLATFORMS DB
        </h2>
        <button
          onClick={refresh}
          disabled={busy}
          className="ml-auto rounded border border-electric-cyan/30 bg-electric-cyan/10 px-3 py-1.5 font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-wider text-electric-cyan uppercase hover:bg-electric-cyan/20 disabled:opacity-50"
        >
          {busy ? "SCANNING…" : "REFRESH (~$0.55)"}
        </button>
      </div>
      {err && <p className="mb-3 text-[11px] text-hot-red font-[family-name:var(--font-mono)]">✗ {err}</p>}
      {!snap ? (
        <p className="text-[11px] text-muted-blue">
          No scan yet. REFRESH pulls the prompts whose Google AI answers cite us and each rival,
          from DataForSEO's prompt database.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {(snap.domains ?? []).map((d: any) => (
              <span
                key={d.domain}
                className={`rounded px-2.5 py-1 text-[11px] font-[family-name:var(--font-mono)] border ${
                  d.domain === "georgeyachts.com"
                    ? "border-electric-cyan/40 bg-electric-cyan/10 text-electric-cyan font-bold"
                    : "border-white/10 text-muted-blue"
                }`}
              >
                {d.domain} · {d.total ?? "err"}
              </span>
            ))}
          </div>
          {(snap.our_prompts ?? []).length > 0 && (
            <div className="mb-3">
              <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-emerald/70 uppercase mb-1">
                PROMPTS THAT CITE US
              </p>
              {(snap.our_prompts ?? []).slice(0, 10).map((p: any) => (
                <div key={p.question} className="text-[11px] text-soft-white py-0.5">
                  <span className="text-muted-blue/60 font-[family-name:var(--font-mono)] mr-2">{p.volume}</span>
                  {p.question}
                </div>
              ))}
            </div>
          )}
          {(snap.opportunities ?? []).length > 0 && (
            <div>
              <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-amber/70 uppercase mb-1">
                THEY ARE CITED, WE ARE NOT — THE GEO TO-DO LIST
              </p>
              {(snap.opportunities ?? []).slice(0, 12).map((o: any) => (
                <div key={o.question} className="text-[11px] py-0.5">
                  <span className="text-muted-blue/60 font-[family-name:var(--font-mono)] mr-2">{o.volume}</span>
                  <span className="text-soft-white">{o.question}</span>
                  <span className="text-muted-blue/50 ml-2">({o.cited.join(", ")})</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted-blue/50">
            Platform: {snap.platform} · {new Date(snap.generated_at).toLocaleString()} · Sunday cron
            keeps it fresh
          </p>
        </>
      )}
    </div>
  );
}

// ─── Authority tab (backlink gap + web mentions, 29/8) ─────────────────────
//
// The two halves of the authority problem: who links to the rivals and
// not to us (the pitch target list, paid networks filtered), and who
// already wrote about us (the unlinked-mention easy yes).
function AuthorityTab() {
  const [gap, setGap] = useState<any>(null);
  const [men, setMen] = useState<any>(null);
  const [busyGap, setBusyGap] = useState(false);
  const [busyMen, setBusyMen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/brand-radar/backlink-gap").then((r) => r.json()).then((d) => setGap(d.latest)).catch(() => {});
    fetch("/api/brand-radar/web-mentions").then((r) => r.json()).then((d) => setMen(d.latest)).catch(() => {});
  }, []);

  async function run(kind: "gap" | "men") {
    setErr(null);
    const set = kind === "gap" ? setBusyGap : setBusyMen;
    set(true);
    try {
      const r = await fetch(`/api/brand-radar/${kind === "gap" ? "backlink-gap" : "web-mentions"}`, { method: "POST" });
      const d = await r.json();
      if (d.error) setErr(d.error);
      else if (kind === "gap") setGap(d);
      else setMen(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      set(false);
    }
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-[11px] text-hot-red font-[family-name:var(--font-mono)]">✗ {err}</p>}

      <div className="glass-card p-4 border border-neon-purple/25">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-neon-purple" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-neon-purple uppercase">
            BACKLINK GAP — THEY LINK TO RIVALS, NOT TO US
          </h2>
          <button
            onClick={() => run("gap")}
            disabled={busyGap}
            className="ml-auto rounded border border-neon-purple/30 bg-neon-purple/10 px-3 py-1.5 font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-wider text-neon-purple uppercase hover:bg-neon-purple/20 disabled:opacity-50"
          >
            {busyGap ? "SCANNING…" : "REFRESH (~$0.12)"}
          </button>
        </div>
        {!gap ? (
          <p className="text-[11px] text-muted-blue">No scan yet. Monday cron fills this weekly.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-[11px] font-[family-name:var(--font-mono)]">
              <span className="rounded px-2.5 py-1 border border-electric-cyan/40 bg-electric-cyan/10 text-electric-cyan font-bold">
                {gap.ours?.domain} · {gap.ours?.referring_domains} domains
              </span>
              {(gap.rivals ?? []).map((r: any) => (
                <span key={r.domain} className="rounded px-2.5 py-1 border border-white/10 text-muted-blue">
                  {r.domain} · {r.referring_domains ?? "err"}
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] text-muted-blue/60 uppercase tracking-wider">
                  <tr className="border-b border-white/5">
                    <th className="py-2 pr-3 text-left">Domain</th>
                    <th className="py-2 pr-3 text-right">Rank</th>
                    <th className="py-2 text-left">Links to</th>
                  </tr>
                </thead>
                <tbody>
                  {(gap.candidates ?? []).slice(0, 25).map((c: any) => (
                    <tr key={c.domain} className="border-b border-white/5 last:border-0">
                      <td className="py-1.5 pr-3 font-[family-name:var(--font-mono)] text-soft-white">{c.domain}</td>
                      <td className="py-1.5 pr-3 text-right text-muted-blue">{c.rank}</td>
                      <td className="py-1.5 text-muted-blue/70 text-[11px]">{c.links_to.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-muted-blue/50">
              Paid press-release networks filtered out. The full list feeds the backlink writer,
              which still verifies every address by eye before a pitch is written.
            </p>
          </>
        )}
      </div>

      <div className="glass-card p-4 border border-emerald/25">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-emerald uppercase">
            WEB MENTIONS — WHO ALREADY WROTE ABOUT US
          </h2>
          <button
            onClick={() => run("men")}
            disabled={busyMen}
            className="ml-auto rounded border border-emerald/30 bg-emerald/10 px-3 py-1.5 font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-wider text-emerald uppercase hover:bg-emerald/20 disabled:opacity-50"
          >
            {busyMen ? "SCANNING…" : "REFRESH (~$0.07)"}
          </button>
        </div>
        {!men ? (
          <p className="text-[11px] text-muted-blue">No scan yet. Wednesday cron fills this weekly.</p>
        ) : (
          <>
            <div className="space-y-2">
              {(men.mentions ?? []).slice(0, 20).map((m: any) => (
                <div key={m.url} className="text-[11px]">
                  <a href={m.url} target="_blank" rel="noreferrer" className="text-soft-white hover:text-electric-cyan font-[family-name:var(--font-mono)]">
                    {m.domain}
                  </a>
                  <span className="text-muted-blue/70 ml-2">{m.title ?? m.url}</span>
                </div>
              ))}
              {(men.mentions ?? []).length === 0 && (
                <p className="text-[11px] text-muted-blue">Nothing found on the tracked phrases this week.</p>
              )}
            </div>
            <p className="mt-2 text-[10px] text-muted-blue/50">
              Phrases: {(men.phrases ?? []).join(" · ")} · a mention without a link is the easiest
              pitch in the queue
            </p>
          </>
        )}
      </div>
    </div>
  );
}
