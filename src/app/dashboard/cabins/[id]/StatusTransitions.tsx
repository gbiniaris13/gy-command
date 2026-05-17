"use client";

// Pill row that lets George walk a Cabin through its lifecycle.
// Highlights the current status; only the immediately-adjacent
// transitions are enabled to prevent accidental skips.

import { useState } from "react";
import { useRouter } from "next/navigation";

const FLOW = [
  { key: "draft",      label: "Draft" },
  { key: "invited",    label: "Invited" },
  { key: "active",     label: "Active" },
  { key: "in_voyage",  label: "In voyage" },
  { key: "completed",  label: "Completed" },
  { key: "archived",   label: "Archived" },
];

export default function StatusTransitions({
  cabinId,
  current,
}: {
  cabinId: string;
  current: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentIdx = FLOW.findIndex((s) => s.key === current);

  async function setStatus(next: string) {
    if (!confirm(`Move this cabin to "${next.replace(/_/g, " ")}"?`)) return;
    setBusy(next);
    setError(null);
    try {
      const r = await fetch(`/api/cabins/${cabinId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "update-failed");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{
      background: "#fff",
      border: "1px solid rgba(13,27,42,0.08)",
      padding: "14px 16px",
      marginTop: 14,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 }}>
        Lifecycle
      </div>
      <ol style={{
        listStyle: "none", padding: 0, margin: 0,
        display: "flex", gap: 0, flexWrap: "wrap",
      }}>
        {FLOW.map((s, i) => {
          const isCurrent = s.key === current;
          const isPast = i < currentIdx;
          const isNext = i === currentIdx + 1;
          const canClickPrev = i === currentIdx - 1;     // limited backwards
          const enabled = isNext || canClickPrev;

          return (
            <li key={s.key} style={{ display: "flex", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => enabled && setStatus(s.key)}
                disabled={!enabled || busy !== null}
                style={{
                  padding: "8px 14px",
                  background: isCurrent ? "#C9A84C" : isPast ? "rgba(201,168,76,0.18)" : "#fff",
                  color: isCurrent ? "#0D1B2A" : isPast ? "#0D1B2A" : enabled ? "#0D1B2A" : "#9CA3AF",
                  border: "1px solid " + (isCurrent ? "#C9A84C" : enabled ? "#0D1B2A" : "rgba(13,27,42,0.12)"),
                  fontSize: 11,
                  letterSpacing: 1.8,
                  textTransform: "uppercase",
                  cursor: enabled ? "pointer" : "default",
                  fontWeight: isCurrent ? 600 : 400,
                  minWidth: 96,
                }}
              >
                {busy === s.key ? "…" : s.label}
              </button>
              {i < FLOW.length - 1 && (
                <span style={{
                  color: i < currentIdx ? "#C9A84C" : "#cbd5e1",
                  padding: "0 8px",
                }}>→</span>
              )}
            </li>
          );
        })}
      </ol>
      {error && (
        <p style={{ color: "#b91c1c", fontSize: 12, marginTop: 8 }}>{error}</p>
      )}
      {current === "completed" && (
        <p style={{ fontSize: 12, color: "#16a34a", fontStyle: "italic", marginTop: 10 }}>
          ✓ Memory Anchors auto-scheduled when this cabin reached "completed".
        </p>
      )}
    </div>
  );
}
