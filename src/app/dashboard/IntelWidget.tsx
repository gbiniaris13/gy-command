"use client";

import { useEffect, useState } from "react";

interface IntelMetric {
  value: string | null;
  sub?: string | null;
  connected: boolean;
}

interface IntelPayload {
  ga: IntelMetric;
  gsc: IntelMetric;
  instagram: IntelMetric;
  ahrefs: IntelMetric;
}

const BLOCKS: Array<{
  key: keyof IntelPayload;
  label: string;
  emoji: string;
  color: string;
}> = [
  { key: "ga", label: "Google Analytics", emoji: "📊", color: "#F59E0B" },
  { key: "gsc", label: "Search Console", emoji: "🔍", color: "#10B981" },
  { key: "instagram", label: "Instagram", emoji: "📷", color: "#E4405F" },
  { key: "ahrefs", label: "Ahrefs", emoji: "🔗", color: "#FF5C00" },
];

const REVALIDATE_MS = 5 * 60 * 1000; // 5 min

export default function IntelWidget() {
  const [data, setData] = useState<IntelPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/intel", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as IntelPayload;
        if (!cancelled) setData(json);
      } catch {
        // silent
      }
    };
    load();
    const t = setInterval(load, REVALIDATE_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-neon-purple" />
        <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
          SIGNAL INTELLIGENCE
        </h2>
        <span className="ml-auto font-[family-name:var(--font-mono)] text-[9px] text-muted-blue/50 tracking-wider uppercase">
          SIGINT FEEDS — AUTO REFRESH
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {BLOCKS.map((b) => {
          const metric = data?.[b.key];
          const isConnected = metric?.connected ?? false;
          const value = metric?.value ?? "—";
          const sub = metric?.sub ?? "";
          return (
            <div
              key={b.key}
              className="rounded-lg border border-border-glow bg-glass-light/30 p-3"
              style={{ borderLeft: `3px solid ${b.color}80` }}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm">{b.emoji}</span>
                <span
                  className={`text-[8px] font-bold tracking-wider uppercase ${
                    isConnected ? "text-emerald" : "text-muted-blue/40"
                  }`}
                >
                  {isConnected ? "LIVE" : "OFF"}
                </span>
              </div>
              <p className="font-[family-name:var(--font-display)] text-[10px] font-semibold tracking-wider text-muted-blue/70 uppercase">
                {b.label}
              </p>
              <p className="font-[family-name:var(--font-mono)] text-xl font-bold text-soft-white">
                {value}
              </p>
              <p className="text-[10px] text-muted-blue/50">{sub}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
