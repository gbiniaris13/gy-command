"use client";

// Action bar on the Cabin detail page: concierge toggle, send
// invite, copy public link, print/PDF, delete cabin.

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [concierge, setConcierge] = useState(conciergeOn);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);

  // 2026-05-21 — Open The Cabin as the principal would see it,
  // in a new tab, in read-only mode. The session expires in
  // 15 min and all writes are blocked at the edge. Doesn't
  // notify the customer; doesn't consume the principal's real
  // session.
  async function openPreview() {
    setPreviewBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/cabins/${cabinId}/preview-session`, {
        method: "POST",
      });
      const j = await r.json();
      if (!r.ok || !j?.url) {
        throw new Error(j?.error || `status ${r.status}`);
      }
      window.open(j.url, "_blank", "noopener");
      setMsg("✓ Preview opened in a new tab");
    } catch (e) {
      setMsg(`✕ Preview failed: ${(e as Error).message}`);
    } finally {
      setPreviewBusy(false);
    }
  }

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
      {/* 2026-05-21 — George's "steps as colours" request.
          Three primary actions sit at the head of the bar in
          the order the operator works through them:
            1. TEAL  · Preview as customer  — verify nothing
               looks off from the charterer's side.
            2. GOLD  · Send / resend invite — the magic link
               that actually puts the cabin in their hands.
            3. GHOST · Concierge mode toggle, navigation, etc.
          Sharing with the team and voyage-bundle were gold
          before and competed with #2; both are now ghost. */}
      <button
        type="button"
        onClick={openPreview}
        disabled={previewBusy}
        style={btnPreview}
        title="Opens this cabin in a new tab AS the charterer would see it. Read-only, expires in 15 minutes, the client is never notified."
      >
        {previewBusy ? "Opening…" : "Preview as customer ◉"}
      </button>
      <button
        type="button"
        onClick={() => call("invite", "Magic link sent to " + principalEmail)}
        disabled={busyKey === "invite"}
        style={btnGold}
        title="Email the magic link to the head charterer — this is the link the client uses to enter The Cabin."
      >
        {busyKey === "invite" ? "Sending…" : "Send / resend invite ✉"}
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
      {/* 2026-05-20 — Friend-test pass 4 (George):
          "Στο GY Command όπως πατάω το preference sheet, να πατάω
           και το crew list — να το παίρνω σαν PDF να το στέλνω."
          The crew list pulls from cabin_members.personal_details
          (what each guest filled via /cabin/me) merged with
          cabin_guests_manifest (anything George filled directly).
          Print → "Save as PDF" gives the file. */}
      <a
        href={`/dashboard/cabins/${cabinId}/crew-list`}
        target="_blank"
        rel="noreferrer"
        style={btnGhost as React.CSSProperties}
        title="Crew list for marina paperwork — print or save as PDF. Pulls each guest's self-filled details from The Cabin."
      >
        Crew list →
      </a>
      <button
        type="button"
        onClick={() => setShareDialogOpen(true)}
        style={btnGhost as React.CSSProperties}
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
        style={btnGhost as React.CSSProperties}
        title="Send the album email to every cabin member"
      >
        {busyKey === "voyage-bundle" ? "Sending…" : "Send voyage bundle ✉"}
      </button>
      <span style={{ marginLeft: "auto", fontSize: 12, color: msg?.startsWith("✓") ? "#16a34a" : "#b91c1c" }}>
        {msg}
      </span>

      {/* 2026-05-21 — Pass 7 follow-up (George):
          Destructive delete button. Two modes (soft hides, hard
          wipes operational data). Confirmation modal requires
          typing the vessel name verbatim — same pattern GitHub /
          Vercel / Linear use for repo / project / workspace
          deletion. Placed on its own row separated by a small
          divider so it's never adjacent to the casual concierge
          toggle. Red border (no fill) so it reads as a deliberate
          action, not a primary CTA. */}
      <div style={{
        flexBasis: "100%",
        height: 1,
        background: "rgba(13,27,42,0.08)",
        margin: "10px 0 4px 0",
      }} />
      <button
        type="button"
        onClick={() => setDeleteDialogOpen(true)}
        style={btnDanger}
        title="Delete this cabin (soft or hard)"
      >
        Delete cabin…
      </button>

      {shareDialogOpen && (
        <SharePreferenceSheetDialog
          cabinId={cabinId}
          vesselName={vesselName}
          onClose={() => setShareDialogOpen(false)}
        />
      )}

      {deleteDialogOpen && (
        <DeleteCabinDialog
          cabinId={cabinId}
          vesselName={vesselName}
          principalEmail={principalEmail}
          status={status}
          onClose={() => setDeleteDialogOpen(false)}
          onDeleted={() => {
            // Bounce back to the cabin list — the cabin row is now
            // gone (hard) or hidden (soft) so this detail page would
            // 404 on refresh anyway.
            router.push("/dashboard/cabins");
          }}
        />
      )}
    </div>
  );
}

// =============================================================
// DeleteCabinDialog — type-to-confirm modal
// =============================================================
function DeleteCabinDialog({
  cabinId,
  vesselName,
  principalEmail,
  status,
  onClose,
  onDeleted,
}: {
  cabinId: string;
  vesselName: string;
  principalEmail: string;
  status: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canDelete = typed.trim() === vesselName.trim() && !busy;

  async function onConfirm() {
    if (!canDelete) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/cabins/${cabinId}?mode=${mode}`, {
        method: "DELETE",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        throw new Error(j?.error || `status ${r.status}`);
      }
      onDeleted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Delete ${vesselName}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(13,27,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#ffffff",
          border: "1px solid rgba(13,27,42,0.18)",
          padding: "24px 26px 22px 26px",
          width: "min(560px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          fontFamily: "inherit",
        }}
      >
        <header style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 10,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            color: "#b91c1c",
            fontWeight: 600,
          }}>
            Delete cabin
          </div>
          <h2 style={{
            fontFamily: "var(--gy-font-editorial, Georgia, serif)",
            fontSize: 22,
            fontWeight: 400,
            margin: "8px 0 0 0",
            color: "#0D1B2A",
          }}>
            {vesselName}
          </h2>
          <p style={{
            fontSize: 12,
            color: "#4b5563",
            margin: "4px 0 0 0",
          }}>
            Principal: {principalEmail} · status: {status}
          </p>
        </header>

        <fieldset style={{ border: 0, padding: 0, margin: "12px 0 18px 0" }}>
          <legend style={{
            fontSize: 10,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            color: "#4b5563",
            fontWeight: 600,
            marginBottom: 8,
          }}>
            Mode
          </legend>
          <label style={modeLabelStyle(mode === "soft")}>
            <input
              type="radio"
              name="delete-mode"
              value="soft"
              checked={mode === "soft"}
              onChange={() => setMode("soft")}
              style={{ marginRight: 8 }}
            />
            <strong>Soft delete</strong>
            <em style={{ display: "block", marginTop: 4, color: "#4b5563", fontSize: 12, lineHeight: 1.5 }}>
              Sets <code>deleted_at = now()</code>. The cabin disappears from the dashboard list and from the customer&apos;s view. All operational data (brief, manifest, chat, photos, mood board, anchors) is kept on disk. Reversible by clearing <code>deleted_at</code> in SQL.
            </em>
          </label>
          <label style={modeLabelStyle(mode === "hard")}>
            <input
              type="radio"
              name="delete-mode"
              value="hard"
              checked={mode === "hard"}
              onChange={() => setMode("hard")}
              style={{ marginRight: 8 }}
            />
            <strong>Hard delete</strong>
            <em style={{ display: "block", marginTop: 4, color: "#4b5563", fontSize: 12, lineHeight: 1.5 }}>
              Permanently removes the cabin row. The brief, manifest, chat, mood board, voyage photos, memory anchors and any cabin_members rows go with it via foreign-key cascade. Preserved: the audit log line, any data-consent records, time-capsule letters, and the Filotimo Circle loyalty record (unlinks but doesn&apos;t delete those). Use this for test fixtures you want to recreate from scratch.
            </em>
          </label>
        </fieldset>

        <div style={{ margin: "0 0 12px 0" }}>
          <label htmlFor="delete-confirm" style={{
            display: "block",
            fontSize: 10,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            color: "#4b5563",
            fontWeight: 600,
            marginBottom: 6,
          }}>
            Type the vessel name to confirm
          </label>
          <input
            id="delete-confirm"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={vesselName}
            autoComplete="off"
            spellCheck={false}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "inherit",
              border: "1px solid rgba(13,27,42,0.18)",
              background: "#fff",
              color: "#0D1B2A",
            }}
          />
        </div>

        {err && (
          <p style={{ color: "#b91c1c", fontSize: 13, margin: "0 0 12px 0" }}>
            Failed: {err}
          </p>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={btnGhost as React.CSSProperties}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canDelete}
            style={{
              ...btnDanger,
              opacity: canDelete ? 1 : 0.45,
              cursor: canDelete ? "pointer" : "not-allowed",
            }}
          >
            {busy
              ? "Deleting…"
              : mode === "hard"
                ? "Hard delete permanently"
                : "Soft delete (hide)"}
          </button>
        </div>
      </div>
    </div>
  );
}

function modeLabelStyle(selected: boolean): React.CSSProperties {
  return {
    display: "block",
    padding: "12px 14px",
    border: selected
      ? "1px solid #b91c1c"
      : "1px solid rgba(13,27,42,0.12)",
    background: selected ? "rgba(185,28,28,0.04)" : "#fff",
    marginBottom: 10,
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1.5,
    color: "#0D1B2A",
  };
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
// 2026-05-21 — Teal "preview" step. Distinct enough from gold
// (warm) and ghost (neutral) that the operator can read the
// three primary buttons at a glance: teal preview → gold send →
// ghost everything-else. Same teal as the in-Cabin preview
// banner (#0E7C7B) so a visual through-line connects "click
// here in CRM" to "this is what shows up on the preview".
const btnPreview: React.CSSProperties = {
  ...baseBtn,
  background: "#0E7C7B", color: "#ffffff", borderColor: "#0E7C7B",
};
const btnGhost: React.CSSProperties = {
  ...baseBtn,
  background: "transparent", color: "#0D1B2A",
  borderColor: "rgba(13,27,42,0.2)", textDecoration: "none",
  display: "inline-block",
};
// 2026-05-21 — Pass 7 follow-up: destructive action button.
// Red border on white background — recognisable as "this is the
// dangerous one" without competing with primary CTAs (which are
// navy or gold).
const btnDanger: React.CSSProperties = {
  ...baseBtn,
  background: "transparent",
  color: "#b91c1c",
  borderColor: "#b91c1c",
};
