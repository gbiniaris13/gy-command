"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Partner {
  id: string;
  name: string;
  company: string | null;
  stage: string;
  last_activity_at: string | null;
  days_idle: number;
  status: "URGENT" | "STALE" | "WARM" | "ACTIVE" | "SENT" | "NEW";
}

const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  URGENT: { dot: "bg-hot-red animate-pulse", text: "text-hot-red" },
  STALE: { dot: "bg-amber", text: "text-amber" },
  WARM: { dot: "bg-electric-cyan", text: "text-electric-cyan" },
  ACTIVE: { dot: "bg-emerald", text: "text-emerald" },
  SENT: { dot: "bg-electric-cyan/40", text: "text-electric-cyan/60" },
  NEW: { dot: "bg-neon-purple", text: "text-neon-purple" },
};

function getStatus(stage: string, daysIdle: number): Partner["status"] {
  if (stage === "Closed Won") return "ACTIVE";
  if (daysIdle > 10) return "STALE";
  if (daysIdle > 5 && (stage === "Warm" || stage === "Hot")) return "URGENT";
  if (stage === "Warm" || stage === "Hot" || stage === "Meeting Booked") return "WARM";
  if (stage === "Contacted" || stage === "Proposal Sent") return "SENT";
  return "NEW";
}

export default function PartnershipWidget() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/crm/partnerships")
      .then((r) => (r.ok ? r.json() : { partners: [] }))
      .then((d) => setPartners(d.partners ?? []))
      .catch(() => {});
  }, []);

  const urgentCount = partners.filter((p) => p.status === "URGENT" || p.status === "STALE").length;

  return (
    <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className={`h-2 w-2 rounded-full ${urgentCount > 0 ? "bg-hot-red animate-pulse" : "bg-electric-cyan"}`} />
        <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
          PARTNERSHIP OPS — ALLIANCE STATUS
        </h2>
        <span className="ml-auto font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
          {partners.length} TRACKED
        </span>
        <svg className={`h-4 w-4 text-muted-blue transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {!collapsed && (
        <div className="mt-4">
          {partners.length === 0 ? (
            <p className="py-4 text-center font-[family-name:var(--font-mono)] text-xs text-muted-blue/40">
              NO PARTNERSHIP CONTACTS FOUND
            </p>
          ) : (
            <div className="space-y-2">
              {partners.map((p) => {
                const style = STATUS_STYLE[p.status] ?? STATUS_STYLE.NEW;
                return (
                  <Link
                    key={p.id}
                    href={`/dashboard/contacts/${p.id}`}
                    className="flex items-center gap-3 rounded-lg border border-border-glow bg-glass-light/20 px-3 py-2.5 transition-all hover:border-electric-cyan/20 min-h-[44px]"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-[family-name:var(--font-mono)] text-sm text-soft-white">
                        {p.name}
                      </p>
                      <p className="font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
                        {p.company ?? "—"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-wider ${style.text}`}>
                        {p.status}
                      </span>
                      <p className="font-[family-name:var(--font-mono)] text-[9px] text-muted-blue/40">
                        {p.days_idle > 0 ? `${p.days_idle}d idle` : "active"}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
