"use client";

// Action bar on the Cabin detail page: concierge toggle, send
// invite, copy public link, print/PDF.

import { useState } from "react";
import SharePreferenceSheetDialog from "./SharePreferenceSheetDialog";

export default function CabinDetailActions({
  cabinId,
  conciergeOn,
  status,
  principalEmail,
  vesselName,
}: {
  cabinId: string;
  conciergeOn: boolean;
  status: string;
  principalEmail: string;
  vesselName: string;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [concierge, setConcierge] = useState(conciergeOn);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  async function call(action: string, label: string, body?: unknown) {
    setBusyKey(action);
    setMsg(null);
    try {
      const r = await fetch(`/api/cabins/${cabinId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      setMsg(`✓ ${label}`);
      if (action === "concierge") setConcierge((s) => !s);
    } catch (e) {
      setMsg(`✕ ${label}: ${(e as Error).message}`);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div style={{
      marginTop: 18, padding: "14px 16px", background: "#fff",
      border: "1px solid rgba(13,27,42,0.08)", display: "flex",
      gap: 10, alignItems: "center", flexWrap: "wrap",
    }}>
      <button
        type="button"
        onClick={() => call("invite", "Magic link sent to " + principalEmail)}
        disabled={busyKey === "invite"}
        style={btnPrimary}
      >
        {busyKey === "invite" ? "Sending…" : "Send / resend invite"}
      </button>
      <button
        type="button"
        onClick={() => call("concierge", concierge ? "Concierge mode off" : "Concierge mode on", { on: !concierge })}
        disabled={busyKey === "concierge"}
        style={concierge ? btnGold : btnGhost}
      >
        {concierge ? "● Concierge mode ON" : "○ Concierge mode OFF"}
      </button>
      <a
        href={`/dashboard/cabins/${cabinId}/chat`}
        style={btnGhost as React.CSSProperties}
      >
        Open chat ✺
      </a>
      <a
        href={`/dashboard/cabins/${cabinId}/edit-basics`}
        style={btnGhost as React.CSSProperties}
        title="Vessel, ports, dates, principal charterer, internal ops"
      >
        Edit cabin details →
      </a>
      <a
        href={`/dashboard/cabins/${cabinId}/manifest`}
        style={btnGhost as React.CSSProperties}
        title="Per-guest passport, DOB, nationality, allergies. Feeds the preference sheet + port authorities."
      >
        Guest manifest →
      </a>
      <a
        href={`/dashboard/cabins/${cabinId}/edit`}
        style={btnGhost as React.CSSProperties}
      >
        Edit brief (concierge) →
      </a>
      <a
        href={`/dashboard/cabins/${cabinId}/content`}
        style={btnGhost as React.CSSProperties}
      >
        Edit crew / menu →
      </a>
      <a
        href={`/dashboard/cabins/${cabinId}/audit`}
        style={btnGhost as React.CSSProperties}
      >
        Audit log ◷
      </a>
      <button
        type="button"
        onClick={() => {
          if (confirm("Send the concierge handoff email to " + principalEmail + "? They will see the banner and the Confirm button.")) {
            void call("send-for-review", "Handoff email sent");
          }
        }}
        disabled={busyKey === "send-for-review"}
        style={btnGhost as React.CSSProperties}
      >
        {busyKey === "send-for-review" ? "Sending…" : "Send for review"}
      </button>
      <a
        href={`/dashboard/cabins/${cabinId}/print`}
        target="_blank"
        rel="noreferrer"
        style={btnGhost as React.CSSProperties}
      >
        Internal print (full) →
      </a>
      <a
        href={`/dashboard/cabins/${cabinId}/preference-sheet`}
        target="_blank"
        rel="noreferrer"
        style={btnGhost as React.CSSProperties}
        title="Charter preferences sheet — open in this browser to review or print"
      >
        Preference sheet →
      </a>
      <button
        type="button"
        onClick={() => setShareDialogOpen(true)}
        style={btnGold as React.CSSProperties}
        title="Email a tokenised read-only link to the captain, chef, hostess, management, or owner"
      >
        Share with the team ↗
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm("Schedule Memory Anchors sequence for this cabin? This queues ~8 emails over the next 12 months.")) {
            void call("anchors", "Memory Anchors scheduled");
          }
        }}
        disabled={busyKey === "anchors"}
        style={btnGhost as React.CSSProperties}
      >
        {busyKey === "anchors" ? "Scheduling…" : "Schedule Memory Anchors"}
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm("Send a preview of the Voyage Bundle email to YOU only (not the charterer)?")) {
            void call("voyage-bundle", "Voyage Bundle preview sent to you", { preview: true });
          }
        }}
        disabled={busyKey === "voyage-bundle"}
        style={btnGhost as React.CSSProperties}
        title="Preview the post-charter album email"
      >
        {busyKey === "voyage-bundle" ? "Sending…" : "Preview voyage bundle"}
      </button>
      <button
        type="button"
        onClick={() => {
          if (
            confirm(
              "SEND the Voyage Bundle email to ALL cabin members now? This is the real post-charter delivery — make sure photos are in order first."
            )
          ) {
            void call("voyage-bundle", "Voyage Bundle sent to all members");
          }
        }}
        disabled={busyKey === "voyage-bundle"}
        style={btnGold}
        title="Send the album email to every cabin member"
      >
        {busyKey === "voyage-bundle" ? "Sending…" : "Send voyage bundle ✉"}
      </button>
      <span style={{ marginLeft: "auto", fontSize: 12, color: msg?.startsWith("✓") ? "#16a34a" : "#b91c1c" }}>
        {msg}
      </span>

      {shareDialogOpen && (
        <SharePreferenceSheetDialog
          cabinId={cabinId}
          vesselName={vesselName}
          onClose={() => setShareDialogOpen(false)}
        />
      )}
    </div>
  );
}

const baseBtn = {
  padding: "10px 16px", fontSize: 10, letterSpacing: 2,
  textTransform: "uppercase", cursor: "pointer", border: "1px solid",
  fontFamily: "inherit",
} as const;
const btnPrimary: React.CSSProperties = {
  ...baseBtn,
  background: "#0D1B2A", color: "#F8F5F0", borderColor: "#C9A84C",
};
const btnGold: React.CSSProperties = {
  ...baseBtn,
  background: "#C9A84C", color: "#0D1B2A", borderColor: "#C9A84C",
};
const btnGhost: React.CSSProperties = {
  ...baseBtn,
  background: "transparent", color: "#0D1B2A",
  borderColor: "rgba(13,27,42,0.2)", textDecoration: "none",
  display: "inline-block",
};
