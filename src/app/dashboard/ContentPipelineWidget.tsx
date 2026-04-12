"use client";

import { useEffect, useState } from "react";

interface ContentItem {
  title: string;
  slug: string;
  status: "published" | "draft" | "idea";
  date: string | null;
}

const IDEAS = [
  "Greece vs Croatia charter costs",
  "What is APA — explained",
  "Mykonos vs Santorini by yacht",
  "Best Greek islands for families",
  "Superyacht charter etiquette guide",
];

export default function ContentPipelineWidget() {
  const [published, setPublished] = useState<ContentItem[]>([]);
  const [drafts, setDrafts] = useState<ContentItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/content-pipeline")
      .then((r) => (r.ok ? r.json() : { published: [], drafts: [] }))
      .then((d) => {
        setPublished(d.published ?? []);
        setDrafts(d.drafts ?? []);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className="h-2 w-2 rounded-full bg-neon-purple" />
        <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
          CONTENT OPS — PUBLICATION STATUS
        </h2>
        <svg className={`ml-auto h-4 w-4 text-muted-blue transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {!collapsed && (
        <div className="mt-4 space-y-4">
          {/* Published */}
          {published.length > 0 && (
            <div>
              <p className="mb-2 font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[2px] text-emerald/70">
                DEPLOYED
              </p>
              <div className="space-y-1.5">
                {published.map((item) => (
                  <div key={item.slug} className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[11px]">
                    <span className="text-emerald">{"\u2705"}</span>
                    <span className="truncate text-soft-white/80">{item.title}</span>
                    <span className="ml-auto shrink-0 text-[9px] text-muted-blue/40">
                      {item.date ? new Date(item.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Drafts */}
          {drafts.length > 0 && (
            <div>
              <p className="mb-2 font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[2px] text-amber/70">
                IN PROGRESS
              </p>
              <div className="space-y-1.5">
                {drafts.map((item) => (
                  <div key={item.slug} className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[11px]">
                    <span className="text-amber">{"\uD83D\uDD04"}</span>
                    <span className="truncate text-soft-white/80">{item.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ideas queue */}
          <div>
            <p className="mb-2 font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[2px] text-electric-cyan/50">
              INTEL QUEUE
            </p>
            <div className="space-y-1">
              {IDEAS.map((idea) => (
                <div key={idea} className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
                  <span>{"\uD83D\uDCA1"}</span>
                  <span>{idea}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
