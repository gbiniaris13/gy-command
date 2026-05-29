"use client";

// Pipeline pills for a charter request. A sale is non-linear, so
// (unlike The Cabin's strict +/-1 flow) we allow a permissive but
// guarded set of transitions defined in TRANSITIONS. Every change
// asks for confirmation and names both states. Moving to Lost/Won
// prompts for a reason.

import { useState } from "react";
import { useRouter } from "next/navigation";

const FLOW = [
  { key: "new",             label: "New" },
  { key: "drafted",         label: "Drafted" },
  { key: "sent",            label: "Sent" },
  { key: "in_conversation", label: "In conversation" },
  { key: "negotiating",     label: "Negotiating" },
  { key: "won",             label: "Won" },
  { key: "lost",            label: "Lost" },
];

// Where you can go FROM each status.
const TRANSITIONS: Record<string, string[]> = {
  new:             ["drafted", "lost"],
  drafted:         ["sent", "new", "lost"],
  sent:            ["in_conversation", "negotiating", "won", "lost"],
  in_conversation: ["negotiating", "won", "lost"],
  negotiating:     ["in_conversation", "won", "lost"],
  won:             [],
  lost:            ["new"],
};

export default function StatusTransitions({
  requestId,
  current,
}: {
  requestId: string;
  current: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = new Set(TRANSITIONS[current] ?? []);

  async function setStatus(next: string) {
    const from = (current || "—").replace(/_/g, " ").toUpperCase();
    const to = next.replace(/_/g, " ").toUpperCase();
    const ok = confirm(`Move this request from ${from} to ${to}?`);
    if (!ok) return;

    const body: Record<string, unknown> = { status: next };
    if (next === "lost") {
      const reason = prompt("Why was this lost? (optional, helps the pipeline learn)");
      if (reason) body.lost_reason = reason;
    } else if (next === "won") {
      const reason = prompt("Won — any note? (e.g. which yacht, terms)");
      if (reason) body.won_reason = reason;
    }

    setBusy(next);
    setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        Pipeline
      </div>
      <div style={{ fontSize: 11, color: "#4b5563", fontStyle: "italic", marginBottom: 10 }}>
        Current stage is the gold badge. Stages with a dashed navy outline are the moves available from here — clicking one asks you to confirm.
      </div>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FLOW.map((s) => {
          const isCurrent = s.key === current;
          const enabled = allowed.has(s.key);

          let chipStyle: React.CSSProperties = {
            padding: "8px 14px",
            fontSize: 11,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            fontWeight: isCurrent ? 700 : 400,
            minWidth: 96,
            textAlign: "center",
            border: "1px solid transparent",
            cursor: "default",
            transition: "background 140ms ease, border-color 140ms ease",
          };
          if (isCurrent) {
            chipStyle = { ...chipStyle, background: "#C9A84C", color: "#0D1B2A", borderColor: "#C9A84C" };
          } else if (enabled) {
            chipStyle = {
              ...chipStyle,
              background: "#ffffff", color: "#0D1B2A",
              borderStyle: "dashed", borderColor: "#0D1B2A",
              cursor: busy !== null ? "default" : "pointer",
            };
          } else {
            chipStyle = { ...chipStyle, background: "#ffffff", color: "#9CA3AF", borderColor: "rgba(13,27,42,0.08)" };
          }

          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => enabled && setStatus(s.key)}
                disabled={!enabled || busy !== null}
                aria-current={isCurrent ? "step" : undefined}
                title={
                  isCurrent
                    ? `Current status: ${s.label}`
                    : enabled
                      ? `Move to ${s.label} (you'll be asked to confirm)`
                      : `${s.label} — not reachable from here`
                }
                style={chipStyle}
              >
                {busy === s.key ? "…" : s.label}
              </button>
            </li>
          );
        })}
      </ol>
      {error && <p style={{ color: "#b91c1c", fontSize: 12, marginTop: 8 }}>{error}</p>}
    </div>
  );
}
