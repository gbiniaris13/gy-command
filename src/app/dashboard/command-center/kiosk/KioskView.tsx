"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CommandCenterSnapshot } from "@/lib/command-center-snapshot";

interface Props {
  snapshot: CommandCenterSnapshot;
}

const PRIORITY_BAR: Record<string, string> = {
  critical: "#ff0064",
  high: "#ff6644",
  medium: "#ffaa00",
  low: "#00ff88",
};

const TONE_COLOR: Record<string, string> = {
  bad: "#ff3366",
  warn: "#ffaa00",
  good: "#00ff88",
};

function fmtClock(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export default function KioskView({ snapshot }: Props) {
  const router = useRouter();
  const [now, setNow] = useState<Date>(() => new Date());

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Auto-refresh data every 60s — Next.js server fetch re-runs the page
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);

  const { metrics, priorities } = snapshot;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#010810",
        color: "#a0ffe0",
        fontFamily: "monospace",
        padding: "clamp(12px, 3vw, 32px)",
        boxSizing: "border-box",
      }}
    >
      {/* HEADER — clock + title + back link */}
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: "clamp(16px, 3vw, 32px)",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontSize: "clamp(36px, 10vw, 96px)",
            fontWeight: 900,
            color: "#00ffc8",
            letterSpacing: 4,
            lineHeight: 1,
            textShadow: "0 0 20px rgba(0,255,200,0.4)",
          }}
        >
          {fmtClock(now)}
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: "clamp(11px, 1.6vw, 14px)",
              letterSpacing: 3,
              color: "rgba(160,255,224,0.6)",
              textTransform: "uppercase",
            }}
          >
            GY COMMAND · KIOSK
          </div>
          <button
            onClick={() => router.push("/dashboard/command-center")}
            style={{
              marginTop: 6,
              background: "transparent",
              border: "1px solid rgba(0,255,200,0.3)",
              color: "#00ffc8",
              fontFamily: "monospace",
              fontSize: 10,
              letterSpacing: 2,
              padding: "4px 10px",
              borderRadius: 3,
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            ← Full UI
          </button>
        </div>
      </header>

      {/* METRICS — 2x2 huge grid on mobile, 4x1 on tablet+ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 45%), 1fr))",
          gap: "clamp(8px, 2vw, 16px)",
          marginBottom: "clamp(16px, 3vw, 32px)",
        }}
      >
        {metrics.map((m) => (
          <div
            key={m.id}
            onClick={() => router.push(m.route)}
            style={{
              background: "rgba(0, 20, 40, 0.7)",
              border: "1px solid rgba(0, 255, 200, 0.2)",
              borderRadius: 8,
              padding: "clamp(12px, 2.5vw, 24px)",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                fontSize: "clamp(9px, 1.4vw, 12px)",
                letterSpacing: 2,
                color: "rgba(160,255,224,0.55)",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              {m.label}
            </div>
            <div
              style={{
                fontSize: "clamp(40px, 8vw, 80px)",
                fontWeight: 900,
                color: "#00ffc8",
                lineHeight: 1,
                textShadow: "0 0 15px rgba(0,255,200,0.4)",
                wordBreak: "break-all",
              }}
            >
              {m.value}
              <span style={{ fontSize: "0.5em", opacity: 0.7 }}>{m.suffix}</span>
            </div>
          </div>
        ))}
      </div>

      {/* TOP ACTIONS — large readable list */}
      {priorities.actions.length > 0 && (
        <div
          style={{
            background: "rgba(0, 20, 40, 0.55)",
            border: "1px solid rgba(0, 255, 200, 0.2)",
            borderRadius: 8,
            padding: "clamp(12px, 2.5vw, 20px)",
            marginBottom: "clamp(16px, 3vw, 32px)",
          }}
        >
          <div
            style={{
              fontSize: "clamp(10px, 1.4vw, 12px)",
              letterSpacing: 3,
              color: "rgba(160,255,224,0.6)",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            TODAY&apos;S PRIORITIES
          </div>
          {priorities.actions.map((a, i) => {
            const bar = PRIORITY_BAR[a.priority] ?? PRIORITY_BAR.medium;
            return (
              <div
                key={a.id}
                onClick={() => {
                  if (a.contact_id) router.push(`/dashboard/contacts/${a.contact_id}`);
                }}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "clamp(10px, 2vw, 14px) 0",
                  borderTop: i === 0 ? "none" : "1px solid rgba(0,255,200,0.08)",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: 4,
                    background: bar,
                    borderRadius: 2,
                    flexShrink: 0,
                    boxShadow: `0 0 6px ${bar}`,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "clamp(13px, 2vw, 17px)",
                      color: "#a0ffe0",
                      fontWeight: 600,
                      lineHeight: 1.4,
                    }}
                  >
                    {a.title}
                  </div>
                  {a.expected_commission_eur > 0 && (
                    <div
                      style={{
                        fontSize: "clamp(11px, 1.6vw, 14px)",
                        fontWeight: 700,
                        color: "#00ffc8",
                        marginTop: 4,
                      }}
                    >
                      €{Math.round(a.expected_commission_eur).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* COUNTERS — 4 across on tablet+, 2x2 on mobile */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 45%), 1fr))",
          gap: "clamp(8px, 2vw, 12px)",
          marginBottom: "clamp(16px, 3vw, 32px)",
        }}
      >
        {priorities.counters.map((c) => {
          const numColor = TONE_COLOR[c.tone] ?? TONE_COLOR.good;
          return (
            <div
              key={c.id}
              onClick={() => router.push(c.route)}
              style={{
                background: "rgba(0, 20, 40, 0.55)",
                border: "1px solid rgba(0, 255, 200, 0.18)",
                borderRadius: 6,
                padding: "clamp(10px, 2vw, 16px)",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  fontSize: "clamp(9px, 1.3vw, 11px)",
                  letterSpacing: 1.5,
                  color: "rgba(160,255,224,0.55)",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {c.label}
              </div>
              <div
                style={{
                  fontSize: "clamp(32px, 6vw, 56px)",
                  fontWeight: 900,
                  color: numColor,
                  textShadow: `0 0 10px ${numColor}66`,
                  lineHeight: 1,
                }}
              >
                {c.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* FOOTER — generated at + auto-refresh hint */}
      <div
        style={{
          textAlign: "center",
          fontSize: 10,
          letterSpacing: 2,
          color: "rgba(160,255,224,0.3)",
          paddingTop: 8,
        }}
      >
        AUTO-REFRESH 60s · LAST {new Date(snapshot.generated_at).toISOString().slice(11, 19)} UTC
      </div>
    </div>
  );
}
