"use client";

// Sample menu editor — tagline + a day-by-day list. Each day has
// a short title and a free-text body the chef can describe the
// courses in their own voice. We stay loose on schema so George
// can paste whatever copy the chef sends back.

import { useState } from "react";

type Day = { title: string; body: string };

export default function MenuForm({
  cabinId,
  initial,
}: {
  cabinId: string;
  initial: unknown;
}) {
  const init = (initial && typeof initial === "object" ? (initial as Record<string, unknown>) : {}) as {
    tagline?: string;
    days?: Array<{ title?: string; body?: string; courses?: unknown }>;
  };
  const [tagline, setTagline] = useState<string>(init.tagline ?? "");
  const [days, setDays] = useState<Day[]>(() => {
    const src = Array.isArray(init.days) ? init.days : [];
    return src.map((d) => ({
      title: d?.title ?? "",
      // Older docs use courses[]; collapse to a readable body.
      body:
        d?.body ??
        (Array.isArray(d?.courses)
          ? d.courses
              .map((c) =>
                typeof c === "string"
                  ? c
                  : c && typeof c === "object" && "heading" in (c as Record<string, unknown>)
                  ? `${(c as Record<string, string>).heading}: ${(c as Record<string, string>).body ?? ""}`
                  : ""
              )
              .filter(Boolean)
              .join("\n")
          : ""),
    }));
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function updateDay(i: number, patch: Partial<Day>) {
    setDays((d) => d.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }
  function removeDay(i: number) {
    setDays((d) => d.filter((_, j) => j !== i));
  }
  function addDay() {
    setDays((d) => [...d, { title: `Day ${d.length + 1}`, body: "" }]);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const cleaned = {
      tagline: tagline.trim() || undefined,
      days: days
        .map((d) => ({ title: d.title.trim(), body: d.body.trim() }))
        .filter((d) => d.title || d.body),
    };
    try {
      const r = await fetch(`/api/cabins/${cabinId}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_menu: cleaned }),
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
        <h3 style={h3}>Sample menu (what the client sees on /cabin/menu)</h3>
        <p style={sub}>
          One day per row. Tagline at the top is the chef’s overall voice
          (e.g. “Cretan-Aegean, what the morning fishmonger has”). Inside
          each day, paste the menu in your own format — the client view
          renders it as plain text.
        </p>
      </header>

      <label style={field}>
        <span>Tagline</span>
        <input
          type="text"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Cretan-Aegean, what the morning fishmonger has"
        />
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
        {days.length === 0 && (
          <p style={empty}><em>No sample days yet — add Day 1 below.</em></p>
        )}
        {days.map((d, i) => (
          <div key={i} style={row}>
            <label style={field}>
              <span>Day title</span>
              <input
                type="text"
                value={d.title}
                onChange={(e) => updateDay(i, { title: e.target.value })}
                placeholder="Day 1 · Arrival sunset"
              />
            </label>
            <label style={field}>
              <span>Courses / description</span>
              <textarea
                value={d.body}
                onChange={(e) => updateDay(i, { body: e.target.value })}
                rows={5}
                placeholder={"Welcome aperitif — Domaine Sigalas Assyrtiko\nGrilled octopus on a bed of fava\nLamb shoulder, oregano potatoes\nFig & yoghurt with thyme honey"}
              />
            </label>
            <button type="button" onClick={() => removeDay(i)} style={removeBtn}>
              × Remove this day
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={addDay} style={btnGhost}>
          + Add another day
        </button>
        <button type="button" onClick={save} disabled={busy} style={btnPrimary}>
          {busy ? "Saving…" : "Save menu"}
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
const h3: React.CSSProperties = { margin: 0, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 400 };
const sub: React.CSSProperties = { margin: "4px 0 0", fontSize: 12, color: "#6b7280", fontStyle: "italic" };
const row: React.CSSProperties = {
  border: "1px solid rgba(13,27,42,0.06)",
  padding: 12,
  background: "#fafafa",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const empty: React.CSSProperties = { fontStyle: "italic", color: "#6b7280", fontSize: 13, margin: 0 };
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
