"use client";

// Client actions for a charter request: add an internal note, and
// delete the request. Generate (proposal PDF) and Send (Gmail) land
// in later build steps; shown here as disabled so the UI is honest
// about what works today.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HelmDetailActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "note-failed");
      setNote("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this request permanently? This also removes its conversation log. This cannot be undone.")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/helm/${requestId}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "delete-failed");
      router.push("/dashboard/helm");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 }}>
        Actions
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <button type="button" disabled title="Arrives in the next build step (Generate)" style={pendingBtn}>
          Generate proposal · soon
        </button>
        <button type="button" disabled title="Arrives in the next build step (Send)" style={pendingBtn}>
          Send · soon
        </button>
      </div>

      <label style={{ fontSize: 11, color: "#374151", display: "block", marginBottom: 6 }}>
        Add an internal note
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Logged a call, client wants August, prefers a power cat…"
        style={{ width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
        <button type="button" onClick={addNote} disabled={busy || !note.trim()} style={primaryBtn}>
          {busy ? "…" : "Add note"}
        </button>
        <button type="button" onClick={remove} disabled={busy} style={dangerBtn}>
          Delete request
        </button>
      </div>
      {error && <p style={{ color: "#b91c1c", fontSize: 12, marginTop: 8 }}>{error}</p>}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C",
  padding: "8px 16px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer",
};
const dangerBtn: React.CSSProperties = {
  background: "#fff", color: "#b91c1c", border: "1px solid rgba(185,28,28,0.4)",
  padding: "8px 16px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer",
};
const pendingBtn: React.CSSProperties = {
  background: "#f3f4f6", color: "#9CA3AF", border: "1px dashed rgba(13,27,42,0.12)",
  padding: "8px 16px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "not-allowed",
};
