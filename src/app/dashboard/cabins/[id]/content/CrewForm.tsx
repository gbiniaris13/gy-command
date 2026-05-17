"use client";

// Form-based crew editor — no JSON to write by hand. Each row is
// a small card; add / remove with one click; auto-save on Save.
// Underlying field stays JSONB ({first_name, role, bio}) so the
// client-side /cabin/crew page renders unchanged.

import { useState } from "react";

type CrewMember = {
  first_name: string;
  role: string;
  bio: string;
};

export default function CrewForm({
  cabinId,
  initial,
}: {
  cabinId: string;
  initial: unknown;
}) {
  const [rows, setRows] = useState<CrewMember[]>(() => {
    if (!Array.isArray(initial)) return [];
    return (initial as CrewMember[]).map((c) => ({
      first_name: c?.first_name ?? "",
      role: c?.role ?? "",
      bio: c?.bio ?? "",
    }));
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function update(i: number, patch: Partial<CrewMember>) {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }
  function remove(i: number) {
    setRows((r) => r.filter((_, j) => j !== i));
  }
  function add() {
    setRows((r) => [...r, { first_name: "", role: "", bio: "" }]);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const cleaned = rows
      .map((r) => ({
        first_name: r.first_name.trim(),
        role: r.role.trim(),
        bio: r.bio.trim(),
      }))
      .filter((r) => r.first_name || r.role || r.bio);
    try {
      const r = await fetch(`/api/cabins/${cabinId}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crew_display: cleaned }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "save-failed");
      setMsg({ ok: true, text: "Saved · the client view is updated." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={card}>
      <header style={hdr}>
        <h3 style={h3}>Crew (what the client sees on /cabin/crew)</h3>
        <p style={sub}>
          First name + role + a 1–2 line voice-of-yacht bio. White-labelled —
          no surnames, no owner references. Drag order isn’t implemented;
          items render in the order shown below.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.length === 0 && (
          <p style={empty}><em>No crew members yet — add the captain first.</em></p>
        )}
        {rows.map((r, i) => (
          <div key={i} style={row}>
            <div style={rowGrid}>
              <label style={field}>
                <span>First name</span>
                <input
                  type="text"
                  value={r.first_name}
                  onChange={(e) => update(i, { first_name: e.target.value })}
                  placeholder="Stavros"
                />
              </label>
              <label style={field}>
                <span>Role</span>
                <input
                  type="text"
                  value={r.role}
                  onChange={(e) => update(i, { role: e.target.value })}
                  placeholder="Captain · Chef · Hostess · Deckhand"
                />
              </label>
            </div>
            <label style={field}>
              <span>Bio (1–2 sentences)</span>
              <textarea
                value={r.bio}
                onChange={(e) => update(i, { bio: e.target.value })}
                rows={2}
                placeholder="Twenty-two years across Greek waters. Quiet, exacting, generous at sundown."
              />
            </label>
            <button type="button" onClick={() => remove(i)} style={removeBtn}>
              × Remove this member
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={add} style={btnGhost}>
          + Add crew member
        </button>
        <button type="button" onClick={save} disabled={busy} style={btnPrimary}>
          {busy ? "Saving…" : "Save crew"}
        </button>
        {msg && (
          <span style={{
            fontSize: 12,
            color: msg.ok ? "#16a34a" : "#b91c1c",
            fontFamily: "Georgia, serif",
            fontStyle: msg.ok ? "italic" : "normal",
          }}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(13,27,42,0.08)",
  padding: 18,
};
const hdr: React.CSSProperties = { marginBottom: 14 };
const h3: React.CSSProperties = {
  margin: 0, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 400,
};
const sub: React.CSSProperties = {
  margin: "4px 0 0", fontSize: 12, color: "#6b7280", fontStyle: "italic",
};
const row: React.CSSProperties = {
  border: "1px solid rgba(13,27,42,0.06)",
  padding: 12,
  background: "#fafafa",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const rowGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
};
const field: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const empty: React.CSSProperties = {
  fontStyle: "italic",
  color: "#6b7280",
  fontSize: 13,
  margin: 0,
};
const removeBtn: React.CSSProperties = {
  alignSelf: "flex-start",
  background: "transparent",
  border: 0,
  color: "#b91c1c",
  fontSize: 11,
  cursor: "pointer",
  padding: 0,
};
const btnGhost: React.CSSProperties = {
  background: "transparent",
  color: "#0D1B2A",
  border: "1px solid rgba(13,27,42,0.2)",
  padding: "8px 14px",
  fontSize: 11,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  background: "#0D1B2A",
  color: "#F8F5F0",
  border: "1px solid #C9A84C",
  padding: "8px 16px",
  fontSize: 10,
  letterSpacing: 2,
  textTransform: "uppercase",
  cursor: "pointer",
};
