"use client";

import { useEffect, useState } from "react";

interface PSData {
  mobile: { score: number; lcp: string; cls: string } | null;
  desktop: { score: number; lcp: string; cls: string } | null;
}

function scoreColor(score: number): string {
  if (score >= 90) return "text-emerald";
  if (score >= 50) return "text-amber";
  return "text-hot-red";
}

function scoreDot(score: number): string {
  if (score >= 90) return "bg-emerald";
  if (score >= 50) return "bg-amber";
  return "bg-hot-red";
}

export default function PageSpeedWidget() {
  const [data, setData] = useState<PSData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/intel/pagespeed")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-emerald" />
        <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
          SITE PERFORMANCE
        </h2>
        <span className="ml-auto font-[family-name:var(--font-mono)] text-[9px] text-muted-blue/50 tracking-wider uppercase">
          PAGESPEED INSIGHTS
        </span>
      </div>
      {loading ? (
        <p className="font-[family-name:var(--font-mono)] text-xs text-muted-blue/50">SCANNING...</p>
      ) : !data ? (
        <p className="font-[family-name:var(--font-mono)] text-xs text-muted-blue/50">SCAN FAILED</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: "MOBILE", d: data.mobile, icon: "\uD83D\uDCF1" },
            { label: "DESKTOP", d: data.desktop, icon: "\uD83D\uDDA5\uFE0F" },
          ].map((item) => (
            <div key={item.label} className="rounded border border-border-glow bg-glass-light/20 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-muted-blue/60">
                  {item.icon} {item.label}
                </span>
                {item.d && (
                  <span className={`h-1.5 w-1.5 rounded-full ${scoreDot(item.d.score)}`} />
                )}
              </div>
              {item.d ? (
                <>
                  <p className={`font-[family-name:var(--font-mono)] text-3xl font-bold ${scoreColor(item.d.score)}`}>
                    {item.d.score}
                  </p>
                  <div className="mt-2 space-y-1">
                    <p className="font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/60">
                      LCP: <span className="text-soft-white">{item.d.lcp}</span>
                    </p>
                    <p className="font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/60">
                      CLS: <span className="text-soft-white">{item.d.cls}</span>
                    </p>
                  </div>
                </>
              ) : (
                <p className="font-[family-name:var(--font-mono)] text-sm text-muted-blue/40">—</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
