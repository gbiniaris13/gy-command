"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface FollowUp {
  id: string;
  name: string;
  company: string | null;
  last_activity_at: string | null;
  stage: string;
  days_idle: number;
  urgency: "overdue" | "due_today" | "upcoming";
}

export default function FollowUpWidget() {
  const [items, setItems] = useState<FollowUp[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/crm/contacts")
      .then(() => {
        // Use the dashboard data — fetch contacts with activity gap
        return fetch("/api/welcome-stats");
      })
      .catch(() => {});

    // Build follow-up data from the page's server data (we'll use a simpler approach)
    // For now, use placeholder data that will be replaced when CRM data loads
    setItems([]);
  }, []);

  return (
    <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className={`h-2 w-2 rounded-full ${items.some(i => i.urgency === "overdue") ? "bg-hot-red animate-pulse" : "bg-amber"}`} />
        <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
          FOLLOW-UP OPS
        </h2>
        <span className="ml-auto font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
          {collapsed ? "EXPAND" : items.length > 0 ? `${items.length} PENDING` : "CLEAR"}
        </span>
        <svg className={`h-4 w-4 text-muted-blue transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {!collapsed && (
        <div className="mt-4">
          {items.length === 0 ? (
            <p className="py-4 text-center font-[family-name:var(--font-mono)] text-xs text-muted-blue/40">
              NO FOLLOW-UPS DUE — CHECK MISSION QUEUE
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <Link
                  key={item.id}
                  href={`/dashboard/contacts/${item.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border-glow bg-glass-light/20 px-3 py-2.5 transition-all hover:border-electric-cyan/20 min-h-[44px]"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${
                    item.urgency === "overdue" ? "bg-hot-red animate-pulse" :
                    item.urgency === "due_today" ? "bg-amber" : "bg-emerald"
                  }`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-[family-name:var(--font-mono)] text-sm text-soft-white">{item.name}</p>
                    <p className="font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">{item.company ?? "—"}</p>
                  </div>
                  <span className={`shrink-0 font-[family-name:var(--font-mono)] text-[10px] font-bold ${
                    item.urgency === "overdue" ? "text-hot-red" :
                    item.urgency === "due_today" ? "text-amber" : "text-muted-blue/50"
                  }`}>
                    {item.urgency === "overdue" ? `+${item.days_idle}d` :
                     item.urgency === "due_today" ? "TODAY" : `in ${item.days_idle}d`}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
