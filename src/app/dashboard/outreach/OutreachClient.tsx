"use client";

import Link from "next/link";
import { getFlagFromCountry } from "@/lib/flags";

// ─── Types ─────────────────────────────────────────────────────────────────

interface PipelineItem {
  name: string;
  count: number;
  color: string;
}

interface RecentContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  country: string | null;
  linkedin_url: string | null;
  last_activity_at: string | null;
  pipeline_stage: { name: string; color: string } | null;
}

interface Props {
  totalSent: number;
  replyRate: number;
  leadsRemaining: number;
  activeFollowups: number;
  pipelineBreakdown: PipelineItem[];
  recentContacts: RecentContact[];
  totalContacts: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

const STAGE_BADGE: Record<string, { bg: string; text: string }> = {
  New: { bg: "bg-gray-500/20", text: "text-gray-400" },
  Contacted: { bg: "bg-blue-500/20", text: "text-blue-400" },
  Warm: { bg: "bg-amber-500/20", text: "text-amber-400" },
  Hot: { bg: "bg-red-500/20", text: "text-red-400" },
  Won: { bg: "bg-emerald-500/20", text: "text-emerald-400" },
  Lost: { bg: "bg-gray-500/20", text: "text-gray-500" },
};

// ─── Component ─────────────────────────────────────────────────────────────

export default function OutreachClient({
  totalSent,
  replyRate,
  leadsRemaining,
  activeFollowups,
  pipelineBreakdown,
  recentContacts,
  totalContacts,
}: Props) {
  const stats = [
    {
      label: "Total Sent",
      value: String(totalSent),
      sub: "outreach emails",
      color: "text-blue-400",
    },
    {
      label: "Reply Rate",
      value: `${replyRate.toFixed(1)}%`,
      sub: "warm / total sent",
      color: "text-amber-400",
    },
    {
      label: "Leads Remaining",
      value: String(leadsRemaining),
      sub: "to be contacted",
      color: leadsRemaining < 100 ? "text-amber-400" : "text-emerald-400",
    },
    {
      label: "Active Follow-ups",
      value: String(activeFollowups),
      sub: "in progress",
      color: "text-purple-400",
    },
  ];

  const maxPipelineCount = Math.max(...pipelineBreakdown.map((p) => p.count), 1);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-[family-name:var(--font-montserrat)] text-2xl font-bold text-ivory">
          Outreach Bot
        </h1>
        <p className="mt-1 text-sm text-ivory/50">
          Automated prospecting pipeline &mdash; {totalContacts} total contacts
        </p>
      </div>

      {/* Alerts */}
      {leadsRemaining === 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4">
          <span className="text-2xl">&#x1F6A8;</span>
          <div>
            <p className="font-[family-name:var(--font-montserrat)] text-sm font-semibold text-red-400">
              No more leads!
            </p>
            <p className="text-xs text-red-400/70">
              The bot has exhausted all prospects. Add more rows to the sheet.
            </p>
          </div>
        </div>
      )}
      {leadsRemaining > 0 && leadsRemaining < 100 && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4">
          <span className="text-2xl">&#x26A0;&#xFE0F;</span>
          <div>
            <p className="font-[family-name:var(--font-montserrat)] text-sm font-semibold text-amber-400">
              Running low &mdash; feed the bot!
            </p>
            <p className="text-xs text-amber-400/70">
              Only {leadsRemaining} leads remaining. Add more prospects to keep outreach going.
            </p>
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-white/5 bg-navy-light p-5"
          >
            <p className="text-xs font-medium tracking-wider text-ivory/40 uppercase">
              {stat.label}
            </p>
            <p
              className={`mt-2 font-[family-name:var(--font-montserrat)] text-3xl font-bold ${stat.color}`}
            >
              {stat.value}
            </p>
            <p className="mt-1 text-xs text-ivory/30">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Pipeline Breakdown */}
      <div className="mb-8 rounded-xl border border-white/5 bg-navy-light p-6">
        <h2 className="mb-5 font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory">
          Pipeline Breakdown
        </h2>
        <div className="space-y-3">
          {pipelineBreakdown.map((item) => {
            const pct = totalContacts > 0 ? (item.count / totalContacts) * 100 : 0;
            const barWidth = maxPipelineCount > 0 ? (item.count / maxPipelineCount) * 100 : 0;
            return (
              <div key={item.name} className="flex items-center gap-4">
                <span className="w-24 shrink-0 text-sm font-medium text-ivory/60">
                  {item.name}
                </span>
                <div className="relative flex-1 h-7 rounded-md bg-navy/60 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-md transition-all duration-500"
                    style={{
                      width: `${Math.max(barWidth, 1)}%`,
                      backgroundColor: item.color,
                      opacity: 0.8,
                    }}
                  />
                  <div className="relative flex h-full items-center px-3">
                    <span className="text-xs font-semibold text-ivory drop-shadow-sm">
                      {item.count}
                    </span>
                  </div>
                </div>
                <span className="w-14 shrink-0 text-right text-xs text-ivory/40">
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="rounded-xl border border-white/5 bg-navy-light p-6">
        <h2 className="mb-5 font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory">
          Recent Outreach Activity
        </h2>
        {recentContacts.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-ivory/30">No outreach contacts yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentContacts.map((contact) => {
              const stageName = contact.pipeline_stage?.name ?? "Unknown";
              const badge = STAGE_BADGE[stageName] ?? STAGE_BADGE.New;
              const name =
                [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
                "Unnamed";
              return (
                <Link
                  key={contact.id}
                  href={`/dashboard/contacts/${contact.id}`}
                  className="flex items-center gap-4 rounded-lg border border-white/5 bg-navy-lighter/50 px-4 py-3 transition-colors hover:border-gold/30 hover:bg-navy-lighter"
                >
                  <span className="text-lg">
                    {getFlagFromCountry(contact.country)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ivory">
                      {name}
                      {contact.linkedin_url && (
                        <a
                          href={contact.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-[#0a66c2] transition-colors hover:bg-[#0a66c2]/15"
                          title="Open LinkedIn profile"
                          aria-label="Open LinkedIn profile"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                          </svg>
                        </a>
                      )}
                    </p>
                    {contact.company && (
                      <p className="truncate text-xs text-ivory/40">
                        {contact.company}
                      </p>
                    )}
                  </div>
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}
                  >
                    {stageName}
                  </span>
                  <span className="shrink-0 text-xs text-ivory/30">
                    {timeAgo(contact.last_activity_at)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
