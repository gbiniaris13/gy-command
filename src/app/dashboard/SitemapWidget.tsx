"use client";

import { useEffect, useState } from "react";

export default function SitemapWidget() {
  const [urlCount, setUrlCount] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/intel/sitemap")
      .then((r) => r.json())
      .then((d) => setUrlCount(d.count ?? null))
      .catch(() => {});
  }, []);

  return (
    <div className="glass-card p-4 sm:p-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className="h-2 w-2 rounded-full bg-electric-cyan" />
        <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
          SITEMAP INDEX
        </h2>
        <svg className={`ml-auto h-4 w-4 text-muted-blue transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {!collapsed && (
        <div className="mt-3 space-y-1.5 font-[family-name:var(--font-mono)] text-xs">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
            <span className="text-muted-blue/60">URLs INDEXED:</span>
            <span className="text-electric-cyan font-bold">{urlCount ?? "..."}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
            <span className="text-muted-blue/60">STATUS:</span>
            <span className="text-emerald">ALL RESPONDING</span>
          </div>
        </div>
      )}
    </div>
  );
}
