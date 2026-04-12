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
  sigint: string;
  label: string;
  color: string;
  envVar: string;
  setupSteps: string[];
}> = [
  {
    key: "ga",
    sigint: "SIGINT-ALPHA",
    label: "ANALYTICS",
    color: "#F59E0B",
    envVar: "GA_SERVICE_ACCOUNT_JSON",
    setupSteps: [
      "console.cloud.google.com",
      "Create Service Account",
      "Download JSON key",
      "Set GA_SERVICE_ACCOUNT_JSON",
    ],
  },
  {
    key: "gsc",
    sigint: "SIGINT-BRAVO",
    label: "SEARCH CONSOLE",
    color: "#10B981",
    envVar: "GSC_SERVICE_ACCOUNT_JSON",
    setupSteps: [
      "Enable Search Console API",
      "Add service account to GSC",
      "Set GSC_SERVICE_ACCOUNT_JSON",
    ],
  },
  {
    key: "instagram",
    sigint: "SIGINT-CHARLIE",
    label: "INSTAGRAM",
    color: "#E4405F",
    envVar: "IG_ACCESS_TOKEN",
    setupSteps: [
      "developers.facebook.com",
      "Create app → IG Graph API",
      "Generate long-lived token",
      "Set IG_ACCESS_TOKEN + IG_BUSINESS_ID",
    ],
  },
  {
    key: "ahrefs",
    sigint: "SIGINT-DELTA",
    label: "SEO AUTHORITY",
    color: "#FF5C00",
    envVar: "MOZ_ACCESS_ID",
    setupSteps: [
      "moz.com/products/api",
      "Get free API access",
      "Set MOZ_ACCESS_ID + MOZ_SECRET_KEY",
    ],
  },
];

const REVALIDATE_MS = 5 * 60 * 1000;

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {BLOCKS.map((b) => {
          const metric = data?.[b.key];
          const isConnected = metric?.connected ?? false;
          const value = metric?.value ?? "—";
          const sub = metric?.sub ?? "";
          const hasError = sub.includes("403") || sub.includes("error");

          return (
            <div
              key={b.key}
              className="rounded-lg border border-border-glow bg-glass-light/20 p-3"
              style={{ borderLeft: `3px solid ${isConnected ? b.color : "rgba(245,158,11,0.4)"}` }}
            >
              {/* SIGINT header */}
              <div className="mb-2 flex items-center justify-between">
                <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[2px] text-muted-blue/60">
                  {b.sigint}
                </span>
                <span
                  className={`flex items-center gap-1 font-[family-name:var(--font-mono)] text-[8px] font-bold tracking-wider uppercase ${
                    isConnected
                      ? "text-emerald"
                      : hasError
                      ? "text-hot-red"
                      : "text-amber"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    isConnected ? "bg-emerald" : hasError ? "bg-hot-red" : "bg-amber animate-pulse"
                  }`} />
                  {isConnected ? "ONLINE" : hasError ? "ERROR" : "STANDBY"}
                </span>
              </div>

              {/* Label */}
              <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[1.5px] text-muted-blue/80 uppercase">
                {b.label}
              </p>

              {isConnected ? (
                <>
                  <p className="mt-1 font-[family-name:var(--font-mono)] text-xl font-bold text-soft-white">
                    {value}
                  </p>
                  <p className="text-[10px] text-muted-blue/50">{sub}</p>
                </>
              ) : (
                <div className="mt-2">
                  <p className="font-[family-name:var(--font-mono)] text-[9px] text-amber/70 mb-1">
                    {hasError ? "ACCESS DENIED" : "CONFIGURE UPLINK"}
                  </p>
                  <div className="space-y-0.5">
                    {b.setupSteps.map((step, i) => (
                      <p key={i} className="font-[family-name:var(--font-mono)] text-[8px] text-muted-blue/40">
                        {i + 1}. {step}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
