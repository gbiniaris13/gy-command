"use client";

import { useEffect, useState } from "react";

interface OutreachStats {
  today: { sent: number; opens: number; replies: number; bounces: number };
  week: { sent: number; opens: number; replies: number; bounces: number };
  total: { sent: number; opens: number; replies: number; bounces: number };
  recent: Array<{ text: string; date: string; type: string }>;
  botActive: boolean;
}

const TYPE_ICON: Record<string, string> = {
  reply: "\uD83D\uDD25",
  open: "\uD83D\uDC41",
  bounce: "\u274C",
  sent: "\u2705",
};

export default function OutreachBotWidget() {
  const [stats, setStats] = useState<OutreachStats | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Try to fetch from Telegram bot feed or Supabase outreach data
    fetch("/api/outreach-stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStats(d);
      })
      .catch(() => {
        // Set placeholder data when API not available
        setStats({
          today: { sent: 0, opens: 0, replies: 0, bounces: 0 },
          week: { sent: 0, opens: 0, replies: 0, bounces: 0 },
          total: { sent: 0, opens: 0, replies: 0, bounces: 0 },
          recent: [],
          botActive: false,
        });
      });
  }, []);

  return (
    <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className={`h-2 w-2 rounded-full ${stats?.botActive ? "bg-emerald animate-pulse" : "bg-amber"}`} />
        <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
          OUTREACH OPS — DEPLOYMENT STATUS
        </h2>
        <svg className={`ml-auto h-4 w-4 text-muted-blue transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {!collapsed && stats && (
        <div className="mt-4">
          {/* Bot status */}
          <div className="mb-4 flex items-center gap-4 font-[family-name:var(--font-mono)] text-xs">
            <span className="text-muted-blue/60">BOT STATUS:</span>
            <span className={stats.botActive ? "text-emerald" : "text-amber"}>
              {stats.botActive ? "\u25CF ACTIVE" : "\u25CF STANDBY"}
            </span>
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: "TODAY", d: stats.today },
              { label: "THIS WEEK", d: stats.week },
              { label: "TOTAL", d: stats.total },
            ].map((period) => (
              <div key={period.label} className="rounded border border-border-glow bg-glass-light/20 p-3">
                <p className="mb-2 font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[2px] text-muted-blue/50">
                  {period.label}
                </p>
                <div className="space-y-1 font-[family-name:var(--font-mono)] text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-blue/60">Sent:</span>
                    <span className="text-electric-cyan">{period.d.sent}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-blue/60">Opens:</span>
                    <span className="text-soft-white">{period.d.opens}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-blue/60">Replies:</span>
                    <span className="text-emerald">{period.d.replies}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-blue/60">Bounces:</span>
                    <span className="text-hot-red">{period.d.bounces}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Recent activity */}
          {stats.recent.length > 0 && (
            <div>
              <p className="mb-2 font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[2px] text-muted-blue/50">
                RECENT ACTIVITY
              </p>
              <div className="space-y-1">
                {stats.recent.slice(0, 5).map((evt, i) => (
                  <div key={i} className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[11px]">
                    <span className="shrink-0">{TYPE_ICON[evt.type] || "\u2705"}</span>
                    <span className="text-muted-blue/40 shrink-0">
                      {new Date(evt.date).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="truncate text-soft-white/80">{evt.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.recent.length === 0 && !stats.botActive && (
            <p className="py-2 font-[family-name:var(--font-mono)] text-[10px] text-amber/60">
              CONFIGURE OUTREACH MODULE TO ACTIVATE
            </p>
          )}
        </div>
      )}
    </div>
  );
}
