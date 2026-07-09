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

type Tab = "overview" | "mentions" | "competitors" | "google" | "traffic" | "history";

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
