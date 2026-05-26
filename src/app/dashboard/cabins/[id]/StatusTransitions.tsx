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

  // Brief 03 / Task 5 — guard every lifecycle transition with an
  // explicit confirm dialog that NAMES both states clearly so a
  // mis-click never silently advances the cabin. The lifecycle
  // chips look like status labels but the enabled ones actually
  // mutate state on click (PATCH /api/cabins/:id { status }), so
  // the confirm step is the safety. State-transition logic itself
  // is untouched.
  async function setStatus(next: string) {
    const from = (current || "—").replace(/_/g, " ").toUpperCase();
    const to = next.replace(/_/g, " ").toUpperCase();
    const ok = confirm(
      `Change cabin status from ${from} to ${to}?\n\n` +
        "This affects what the client and the crew see inside The Cabin. " +
        "Press Cancel if you tapped this by accident.",
    );
    if (!ok) return;
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
      <div style={{ fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 4 }}>
        Lifecycle
      </div>
      {/* Brief 03 / Task 5 — small helper line so the operator
          understands the row is interactive, not decorative. */}
      <div style={{ fontSize: 11, color: "#4b5563", fontStyle: "italic", marginBottom: 10 }}>
        Current stage is the gold solid badge. The pill outlined in navy is the next stage you can advance to — clicking it asks you to confirm before anything changes.
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

          // Brief 03 / Task 5 — clickable chips are visually
          // distinct from the current-state badge:
          //   • Current : gold SOLID, no border, no hover lift
          //               → reads as a badge, not a button.
          //   • Clickable: dashed navy outline + cursor:pointer +
          //               a small "→ click to change" affordance.
          //   • Past    : faint gold tint, no outline (history).
          //   • Disabled future: pale grey, no border, default cursor.
          let chipStyle: React.CSSProperties = {
            padding: "8px 14px",
            fontSize: 11,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            fontWeight: isCurrent ? 700 : 400,
            minWidth: 96,
            border: "1px solid transparent",
            cursor: "default",
            transition: "background 140ms ease, border-color 140ms ease",
          };
          if (isCurrent) {
            chipStyle = {
              ...chipStyle,
              background: "#C9A84C",
              color: "#0D1B2A",
              borderColor: "#C9A84C",
              boxShadow: "0 1px 0 rgba(13,27,42,0.05) inset",
            };
          } else if (enabled) {
            chipStyle = {
              ...chipStyle,
              background: "#ffffff",
              color: "#0D1B2A",
              borderStyle: "dashed",
              borderColor: "#0D1B2A",
              cursor: busy !== null ? "default" : "pointer",
            };
          } else if (isPast) {
            chipStyle = {
              ...chipStyle,
              background: "rgba(201,168,76,0.14)",
              color: "rgba(13,27,42,0.7)",
              borderColor: "transparent",
            };
          } else {
            chipStyle = {
              ...chipStyle,
              background: "#ffffff",
              color: "#9CA3AF",
              borderColor: "rgba(13,27,42,0.08)",
            };
          }

          return (
            <li key={s.key} style={{ display: "flex", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => enabled && setStatus(s.key)}
                disabled={!enabled || busy !== null}
                aria-current={isCurrent ? "step" : undefined}
                title={
                  isCurrent
                    ? `Current status: ${s.label}`
                    : enabled
                      ? `Click to change cabin status to ${s.label} (you'll be asked to confirm)`
                      : `Status: ${s.label} — not reachable from the current stage`
                }
                style={chipStyle}
              >
                {busy === s.key ? "…" : s.label}
                {enabled && (
                  <span aria-hidden style={{ marginLeft: 8, opacity: 0.65, fontSize: 10 }}>
                    ↻
                  </span>
                )}
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
