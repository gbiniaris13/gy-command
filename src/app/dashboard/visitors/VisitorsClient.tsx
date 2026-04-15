"use client";

import { useState, useEffect, useCallback } from "react";
import { getFlagFromCountry } from "@/lib/flags";

// ─── Types ─────────────────────────────────────────────────────────────────

interface YachtViewed {
  name: string;
  url?: string;
  viewed_at?: string;
}

interface SessionContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
}

interface VisitorSession {
  id: string;
  session_id: string | null;
  contact_id: string | null;
  country: string | null;
  city: string | null;
  device_type: string | null;
  referrer: string | null;
  pages_visited: string[];
  yachts_viewed: YachtViewed[];
  time_on_site: number;
  is_hot_lead: boolean;
  lead_captured: boolean;
  started_at: string;
  ended_at: string | null;
  contact: SessionContact | null;
}

interface TopYacht {
  name: string;
  count: number;
}

interface Props {
  initialSessions: VisitorSession[];
  visitorsToday: number;
  visitorsWeek: number;
  hotLeads: number;
  captured: number;
  topYachts: TopYacht[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function getSessionIcon(session: VisitorSession): string {
  if (session.lead_captured) return "\uD83C\uDF89"; // party popper
  if (session.is_hot_lead) return "\uD83D\uDD25"; // fire
  if (session.ended_at) return "\uD83D\uDC4B"; // wave
  return "\uD83C\uDF10"; // globe
}

function getSessionBorderColor(session: VisitorSession): string {
  if (session.is_hot_lead) return "border-l-[#C9A84C]";
  if (session.lead_captured) return "border-l-emerald-500";
  return "border-l-gray-600";
}

function getDeviceIcon(type: string | null): string {
  switch (type?.toLowerCase()) {
    case "mobile":
      return "\uD83D\uDCF1";
    case "tablet":
      return "\uD83D\uDCF1";
    case "desktop":
      return "\uD83D\uDCBB";
    default:
      return "\uD83D\uDCBB";
  }
}

// Derive a human-readable source label from the raw referrer URL.
// Mirrors the labels used by the Telegram bot so both surfaces match.
function getSourceLabel(referrer: string | null): string {
  if (!referrer) return "Direct";
  let host = referrer;
  try {
    host = new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    // referrer might already be a bare host — fall through
  }
  host = host.toLowerCase();
  if (!host || host === "direct") return "Direct";
  if (host.includes("google.")) return "Google Search";
  if (host.includes("bing.")) return "Bing";
  if (host.includes("duckduckgo.")) return "DuckDuckGo";
  if (host.includes("chatgpt.") || host.includes("openai.")) return "ChatGPT";
  if (host.includes("claude.ai") || host.includes("anthropic."))
    return "Claude";
  if (host.includes("perplexity.")) return "Perplexity";
  if (host.includes("linkedin.")) return "LinkedIn";
  if (host.includes("facebook.") || host.includes("fb.")) return "Facebook";
  if (host.includes("instagram.")) return "Instagram";
  if (host.includes("t.co") || host.includes("twitter.") || host.includes("x.com"))
    return "Twitter/X";
  if (host.includes("youtube.")) return "YouTube";
  if (host.includes("reddit.")) return "Reddit";
  return host;
}

// Mirrors the Telegram bot threshold: > 3 minutes on site = hot lead signal
// even if the is_hot_lead flag hasn't been persisted yet.
function isHotLeadSignal(session: VisitorSession): boolean {
  return session.is_hot_lead || session.time_on_site > 180;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function VisitorsClient({
  initialSessions,
  visitorsToday,
  visitorsWeek,
  hotLeads,
  captured,
  topYachts,
}: Props) {
  const [sessions, setSessions] = useState<VisitorSession[]>(initialSessions);
  const [stats, setStats] = useState({
    today: visitorsToday,
    week: visitorsWeek,
    hot: hotLeads,
    captured,
  });
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  // Auto-refresh every 30s
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/sessions?limit=50", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.sessions) setSessions(data.sessions);
        if (data.stats) setStats(data.stats);
      }
    } catch {
      // Silently fail on refresh
    }
    setLastRefresh(Date.now());
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const statCards = [
    {
      label: "Visitors Today",
      value: String(stats.today),
      sub: "unique sessions",
      color: "text-blue-400",
    },
    {
      label: "This Week",
      value: String(stats.week),
      sub: "total sessions",
      color: "text-emerald-400",
    },
    {
      label: "Hot Leads",
      value: String(stats.hot),
      sub: "high intent detected",
      color: "text-[#C9A84C]",
    },
    {
      label: "Leads Captured",
      value: String(stats.captured),
      sub: "contact forms filled",
      color: "text-emerald-400",
    },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="mb-1 inline-flex rounded border border-hot-red/30 bg-hot-red/10 px-2 py-0.5">
            <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[3px] text-hot-red uppercase">SURVEILLANCE</span>
          </div>
          <h1 className="font-[family-name:var(--font-mono)] text-lg sm:text-2xl font-black tracking-[3px] text-electric-cyan uppercase">
            PERIMETER SURVEILLANCE
          </h1>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-muted-blue tracking-wider uppercase">
            SITE TRAFFIC — REAL-TIME
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-xs text-[#F8F5F0]/40">
            Live &mdash; refreshed {timeAgo(new Date(lastRefresh).toISOString())}
          </span>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="mb-8 grid grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-white/5 bg-[#1B2B3A] p-5"
          >
            <p className="text-xs font-medium tracking-wider text-[#F8F5F0]/40 uppercase">
              {stat.label}
            </p>
            <p
              className={`mt-2 font-[family-name:var(--font-montserrat)] text-3xl font-bold ${stat.color}`}
            >
              {stat.value}
            </p>
            <p className="mt-1 text-xs text-[#F8F5F0]/30">{stat.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Visitor Feed (2 cols) */}
        <div className="col-span-2 rounded-xl border border-white/5 bg-[#1B2B3A] p-6">
          <h2 className="mb-5 font-[family-name:var(--font-montserrat)] text-lg font-semibold text-[#F8F5F0]">
            Visitor Feed
          </h2>
          {sessions.length === 0 ? (
            <div className="flex h-48 items-center justify-center">
              <p className="text-sm text-[#F8F5F0]/30">No visitor sessions yet</p>
            </div>
          ) : (
            <div className="max-h-[600px] space-y-2 overflow-y-auto pr-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`rounded-lg border border-white/5 bg-[#243447] p-4 border-l-4 ${getSessionBorderColor(session)}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <span className="mt-0.5 text-xl">{getSessionIcon(session)}</span>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">
                          {getFlagFromCountry(session.country)}
                        </span>
                        <span className="text-sm font-medium text-[#F8F5F0]">
                          {session.country ?? "Unknown"}
                        </span>
                        {session.city && (
                          <span className="text-xs text-[#F8F5F0]/40">
                            {session.city}
                          </span>
                        )}
                        <span className="text-xs text-[#F8F5F0]/30">
                          {getDeviceIcon(session.device_type)}{" "}
                          {session.device_type ?? "Unknown"}
                        </span>
                        <span className="inline-flex rounded bg-[#0D1B2A] px-1.5 py-0.5 text-[10px] font-medium text-[#F8F5F0]/60">
                          {getSourceLabel(session.referrer)}
                        </span>
                        {isHotLeadSignal(session) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#C9A84C]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#C9A84C]">
                            &#x1F525; HOT LEAD
                          </span>
                        )}
                      </div>

                      {/* Pages viewed */}
                      {session.pages_visited && session.pages_visited.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {session.pages_visited.slice(0, 6).map((page, idx) => (
                            <span
                              key={idx}
                              className="inline-flex rounded bg-[#0D1B2A] px-1.5 py-0.5 text-[10px] text-[#F8F5F0]/50"
                              title={page}
                            >
                              {page.length > 28 ? page.slice(0, 28) + "…" : page}
                            </span>
                          ))}
                          {session.pages_visited.length > 6 && (
                            <span className="text-[10px] text-[#F8F5F0]/30">
                              +{session.pages_visited.length - 6} more
                            </span>
                          )}
                        </div>
                      )}

                      {/* Yachts viewed */}
                      {session.yachts_viewed.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {session.yachts_viewed.map((yacht, idx) => {
                            const name =
                              typeof yacht === "string" ? yacht : yacht.name;
                            return (
                              <span
                                key={idx}
                                className="inline-flex rounded-full bg-[#C9A84C]/15 px-2 py-0.5 text-[10px] font-medium text-[#C9A84C]"
                              >
                                {name}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Contact match */}
                      {session.contact && (
                        <div className="mt-1.5">
                          <span className="inline-flex items-center gap-1 rounded bg-[#C9A84C]/20 px-2 py-0.5 text-xs font-semibold text-[#C9A84C]">
                            &#x26A1; MATCH:{" "}
                            {[
                              session.contact.first_name,
                              session.contact.last_name,
                            ]
                              .filter(Boolean)
                              .join(" ")}{" "}
                            {session.contact.company
                              ? `from ${session.contact.company}`
                              : ""}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Meta */}
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-[#F8F5F0]/40">
                        {formatDuration(session.time_on_site)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[#F8F5F0]/25">
                        {timeAgo(session.started_at)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Yachts (1 col) */}
        <div className="rounded-xl border border-white/5 bg-[#1B2B3A] p-6">
          <h2 className="mb-5 font-[family-name:var(--font-montserrat)] text-lg font-semibold text-[#F8F5F0]">
            Top Yachts Viewed
          </h2>
          {topYachts.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-sm text-[#F8F5F0]/30">No yacht views yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {topYachts.map((yacht, idx) => {
                const maxCount = topYachts[0]?.count ?? 1;
                const barWidth = (yacht.count / maxCount) * 100;
                return (
                  <div key={yacht.name}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-medium text-[#F8F5F0]/80">
                        <span className="mr-2 text-[#C9A84C]">#{idx + 1}</span>
                        {yacht.name}
                      </span>
                      <span className="text-xs font-semibold text-[#C9A84C]">
                        {yacht.count}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[#0D1B2A]">
                      <div
                        className="h-full rounded-full bg-[#C9A84C]/60 transition-all duration-500"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Refresh indicator */}
          <div className="mt-8 rounded-lg border border-white/5 bg-[#0D1B2A]/50 p-4 text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#C9A84C]/10">
              <svg
                className="h-5 w-5 text-[#C9A84C]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
                />
              </svg>
            </div>
            <p className="text-xs text-[#F8F5F0]/40">
              Auto-refreshes every 30s
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
