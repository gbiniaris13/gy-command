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

// 2026-05-14 — fields with `?` are populated only after the
// visitor-intelligence migration ran in Supabase and were captured
// by the upgraded VisitorTracker. Pre-migration rows just leave them
// undefined/null; UI checks before rendering.
interface VisitorSession {
  id: string;
  session_id: string | null;
  visitor_id?: string | null;
  contact_id: string | null;
  // Geo
  country: string | null;
  region?: string | null;
  city: string | null;
  postal?: string | null;
  lat?: number | null;
  lng?: number | null;
  timezone?: string | null;
  // Device
  device_type: string | null;
  device_tier?: string | null;
  os?: string | null;
  os_version?: string | null;
  browser?: string | null;
  browser_version?: string | null;
  locale?: string | null;
  // Network / company
  ip_company?: string | null;
  ip_asn?: string | null;
  ip_asn_name?: string | null;
  ip_is_vpn?: boolean | null;
  ip_is_hosting?: boolean | null;
  // Source + attribution
  referrer: string | null;
  referrer_url?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  li_fat_id?: string | null;
  // Behaviour
  pages_visited: string[];
  yachts_viewed: YachtViewed[];
  premium_yacht_views?: number;
  time_on_site: number;
  active_seconds?: number | null;
  hidden_seconds?: number | null;
  cta_clicks?: number;
  last_cta?: string | null;
  scroll_deep?: boolean;
  copy_events?: number;
  print_events?: number;
  compare_used?: boolean;
  cost_calc_used?: boolean;
  yacht_finder_used?: boolean;
  pricing_calendar_used?: boolean;
  // Scoring + outcomes
  hot_score?: number | null;
  is_hot_lead: boolean;
  lead_captured: boolean;
  is_return_visitor: boolean;
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
                        {(session.city || session.region) && (
                          <span className="text-xs text-[#F8F5F0]/40">
                            {[session.city, session.region, session.postal]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                        <span className="text-xs text-[#F8F5F0]/30">
                          {getDeviceIcon(session.device_type)}{" "}
                          {session.device_type ?? "Unknown"}
                        </span>
                        {session.device_tier &&
                          session.device_tier !== "unknown" && (
                            <span
                              className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                                session.device_tier === "premium"
                                  ? "bg-[#C9A84C]/20 text-[#C9A84C]"
                                  : session.device_tier === "mid"
                                    ? "bg-blue-400/15 text-blue-300"
                                    : "bg-white/5 text-[#F8F5F0]/40"
                              }`}
                              title={`Device tier — ${[
                                session.os,
                                session.browser,
                                session.locale,
                              ]
                                .filter(Boolean)
                                .join(" · ")}`}
                            >
                              {session.device_tier}
                            </span>
                          )}
                        <span className="inline-flex rounded bg-[#0D1B2A] px-1.5 py-0.5 text-[10px] font-medium text-[#F8F5F0]/60">
                          {getSourceLabel(session.referrer)}
                        </span>
                        {typeof session.hot_score === "number" &&
                          session.hot_score > 0 && (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                session.hot_score >= 10
                                  ? "bg-[#C9A84C]/25 text-[#C9A84C]"
                                  : session.hot_score >= 5
                                    ? "bg-orange-400/20 text-orange-300"
                                    : "bg-white/5 text-[#F8F5F0]/45"
                              }`}
                              title="Composite hot-lead score (0-30+)"
                            >
                              score {session.hot_score.toFixed(1)}
                            </span>
                          )}
                        {isHotLeadSignal(session) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#C9A84C]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#C9A84C]">
                            &#x1F525; HOT LEAD
                          </span>
                        )}
                        {session.is_return_visitor && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-300">
                            &#x1F501; RETURN
                          </span>
                        )}
                        {session.ip_is_vpn && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-purple-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-300"
                            title="Connected via VPN — geo may be misleading"
                          >
                            VPN
                          </span>
                        )}
                        {session.ip_is_hosting && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-red-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300"
                            title="Hosting / datacenter IP — likely automated traffic"
                          >
                            BOT?
                          </span>
                        )}
                      </div>

                      {/* Company / network — biggest single business signal */}
                      {session.ip_company && (
                        <div className="mt-1.5">
                          <span
                            className="inline-flex items-center gap-1 rounded bg-[#0D1B2A] px-2 py-0.5 text-[11px] font-medium text-[#F8F5F0]/75"
                            title={
                              session.ip_asn
                                ? `${session.ip_asn} — ${session.ip_asn_name || ""}`
                                : undefined
                            }
                          >
                            &#x1F3E2; {session.ip_company}
                          </span>
                        </div>
                      )}

                      {/* Attribution row — only render when we have UTM/click-id data */}
                      {(session.utm_source ||
                        session.utm_campaign ||
                        session.gclid ||
                        session.fbclid ||
                        session.li_fat_id) && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {session.utm_source && (
                            <span className="inline-flex rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                              src: {session.utm_source}
                            </span>
                          )}
                          {session.utm_campaign && (
                            <span className="inline-flex rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                              campaign: {session.utm_campaign}
                            </span>
                          )}
                          {session.utm_content && (
                            <span className="inline-flex rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                              content: {session.utm_content}
                            </span>
                          )}
                          {session.gclid && (
                            <span className="inline-flex rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-300">
                              gclid
                            </span>
                          )}
                          {session.fbclid && (
                            <span className="inline-flex rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
                              fbclid
                            </span>
                          )}
                          {session.li_fat_id && (
                            <span className="inline-flex rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">
                              li_fat_id
                            </span>
                          )}
                        </div>
                      )}

                      {/* Intent flags — high-intent surfaces used in session */}
                      {(session.compare_used ||
                        session.cost_calc_used ||
                        session.yacht_finder_used ||
                        session.pricing_calendar_used ||
                        (session.cta_clicks ?? 0) > 0 ||
                        session.scroll_deep ||
                        (session.copy_events ?? 0) > 0 ||
                        (session.print_events ?? 0) > 0) && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {session.compare_used && (
                            <span className="inline-flex rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-300">
                              compare
                            </span>
                          )}
                          {session.cost_calc_used && (
                            <span className="inline-flex rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-300">
                              cost-calc
                            </span>
                          )}
                          {session.yacht_finder_used && (
                            <span className="inline-flex rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-300">
                              yacht-finder
                            </span>
                          )}
                          {session.pricing_calendar_used && (
                            <span className="inline-flex rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-300">
                              pricing-cal
                            </span>
                          )}
                          {(session.cta_clicks ?? 0) > 0 && (
                            <span
                              className="inline-flex rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                              title={
                                session.last_cta
                                  ? `last CTA: ${session.last_cta}`
                                  : undefined
                              }
                            >
                              {session.cta_clicks} CTA{(session.cta_clicks ?? 0) > 1 ? "s" : ""}
                              {session.last_cta ? ` (${session.last_cta})` : ""}
                            </span>
                          )}
                          {session.scroll_deep && (
                            <span className="inline-flex rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-[#F8F5F0]/55">
                              90% scroll
                            </span>
                          )}
                          {(session.copy_events ?? 0) > 0 && (
                            <span className="inline-flex rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-[#F8F5F0]/55">
                              copy &times;{session.copy_events}
                            </span>
                          )}
                          {(session.print_events ?? 0) > 0 && (
                            <span className="inline-flex rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                              PRINTED
                            </span>
                          )}
                          {(session.premium_yacht_views ?? 0) > 0 && (
                            <span className="inline-flex rounded-full bg-[#C9A84C]/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#C9A84C]">
                              {session.premium_yacht_views} premium yacht
                              {(session.premium_yacht_views ?? 0) > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      )}

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
                      <p className="text-xs text-[#F8F5F0]/55">
                        {formatDuration(session.time_on_site)}
                      </p>
                      {typeof session.active_seconds === "number" &&
                        session.active_seconds > 0 && (
                          <p
                            className="text-[10px] text-[#F8F5F0]/30"
                            title="Foreground / active time only (excludes hidden tab)"
                          >
                            active {formatDuration(session.active_seconds)}
                          </p>
                        )}
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
