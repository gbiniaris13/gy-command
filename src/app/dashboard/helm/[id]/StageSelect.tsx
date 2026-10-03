"use client";
// The stage, as one control in the header (2026-10-03, "fewer buttons").
// Replaces the seven-chip pipeline card: same stages, same confirmation,
// same reason prompts for Won and Lost, one dropdown.
import { useState } from "react";
import { useRouter } from "next/navigation";

const STAGES: [string, string, string][] = [
  // Same colours as the list (HelmCrmTable), so a stage reads the same everywhere.
  ["new", "New", "#9CA3AF"],
  ["drafted", "Drafted", "#C9A84C"],
  ["sent", "Sent", "#60A5FA"],
  ["in_conversation", "In conversation", "#34D399"],
  ["negotiating", "Negotiating", "#F59E0B"],
  ["won", "Won", "#0D1B2A"],
  ["lost", "Lost", "#94a3b8"],
];

export default function StageSelect({ requestId, current }: { requestId: string; current: string }) {
  const router = useRouter();
  const [v, setV] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(next: string) {
    if (next === v) return;
    const from = (v || "—").replace(/_/g, " ").toUpperCase();
    const to = next.replace(/_/g, " ").toUpperCase();
    if (!window.confirm(`Move this request from ${from} to ${to}?`)) return;
    const body: Record<string, unknown> = { status: next };
    if (next === "lost") { const reason = window.prompt("Why was this lost? (optional, helps the pipeline learn)"); if (reason) body.lost_reason = reason; }
    else if (next === "won") { const reason = window.prompt("Won. Any note? (e.g. which yacht, terms)"); if (reason) body.won_reason = reason; }
    const prev = v; setV(next); setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "update-failed");
      router.refresh();
    } catch (e) { setV(prev); setError((e as Error).message); } finally { setBusy(false); }
  }
  const color = STAGES.find(([k]) => k === v)?.[2] ?? "#9CA3AF";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <select value={v} disabled={busy} onChange={(e) => change(e.target.value)} title="The stage of this request"
        style={{ appearance: "auto", border: `1px solid ${color}`, background: color, color: "#fff", fontWeight: 600, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", padding: "3px 8px", borderRadius: 3, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
        {STAGES.map(([k, l]) => <option key={k} value={k} style={{ background: "#fff", color: "#0D1B2A" }}>{l}</option>)}
      </select>
      {error && <span style={{ color: "#b91c1c", fontSize: 11 }}>{error}</span>}
    </span>
  );
}
