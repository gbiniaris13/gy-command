"use client";

// Sample menu editor — tagline + a section-by-section list. Each
// section has a name (BREAKFAST, APPETIZERS, MAIN COURSES, etc.)
// and a list of dishes (one per line). Matches the shape Gemini
// extracts from the chef's PDF, and the shape the client-side
// /cabin/menu page renders.

import { useState } from "react";

type Section = { name: string; dishes: string[] };

function normaliseInitial(initial: unknown): { tagline: string; sections: Section[] } {
  const init = (initial && typeof initial === "object" ? (initial as Record<string, unknown>) : {});
  const tagline = typeof init.tagline === "string" ? init.tagline : "";

  // New shape (Gemini extraction): sections[]
  if (Array.isArray(init.sections) && init.sections.length > 0) {
    return {
      tagline,
      sections: (init.sections as Array<Record<string, unknown>>).map((s) => ({
        name: typeof s.name === "string" ? s.name : "",
        dishes: Array.isArray(s.dishes) ? (s.dishes as unknown[]).map(String).filter(Boolean) : [],
      })),
    };
  }

  // Legacy shape: days[] with title + body or courses
  if (Array.isArray(init.days) && init.days.length > 0) {
    return {
      tagline,
      sections: (init.days as Array<Record<string, unknown>>).map((d) => {
        const dishes: string[] = [];
        if (typeof d.body === "string" && d.body.trim()) {
          d.body.split(/\n+/).map((s) => s.trim()).filter(Boolean).forEach((s) => dishes.push(s));
        }
        if (Array.isArray(d.courses)) {
          (d.courses as unknown[]).forEach((c) => {
            if (typeof c === "string" && c.trim()) dishes.push(c.trim());
          });
        }
        return { name: (d.title as string) ?? "Day", dishes };
      }),
    };
  }

  return { tagline, sections: [] };
}

export default function MenuForm({
  cabinId,
  initial,
}: {
  cabinId: string;
  initial: unknown;
}) {
  const init = normaliseInitial(initial);
  const [tagline, setTagline] = useState<string>(init.tagline);
  const [sections, setSections] = useState<Section[]>(init.sections);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function updateSection(i: number, patch: Partial<{ name: string; dishesText: string }>) {
    setSections((rows) =>
      rows.map((row, j) => {
        if (j !== i) return row;
        const next = { ...row };
        if (patch.name !== undefined) next.name = patch.name;
        if (patch.dishesText !== undefined) {
          next.dishes = patch.dishesText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
        }
        return next;
      }),
    );
  }
  function removeSection(i: number) {
    setSections((rows) => rows.filter((_, j) => j !== i));
  }
  function addSection() {
    setSections((rows) => [...rows, { name: "", dishes: [] }]);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const cleaned = {
      tagline: tagline.trim() || undefined,
      sections: sections
        .map((s) => ({ name: s.name.trim(), dishes: s.dishes.filter(Boolean) }))
        .filter((s) => s.name || s.dishes.length),
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
          One section per row (Breakfast, Appetizers, Main Courses, Desserts —
          or by day if the chef’s sample is structured that way). Inside each
          section, paste one dish per line. The client view renders them as
          a typographic list.
        </p>
      </header>

      <label style={field}>
        <span>Tagline (optional)</span>
        <input
          type="text"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Cretan-Aegean, what the morning fishmonger has"
        />
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
        {sections.length === 0 && (
          <p style={empty}><em>No menu sections yet — add one below, or drop the chef’s PDF in the dropzone above.</em></p>
        )}
        {sections.map((s, i) => (
          <div key={i} style={row}>
            <label style={field}>
              <span>Section name</span>
              <input
                type="text"
                value={s.name}
                onChange={(e) => updateSection(i, { name: e.target.value })}
                placeholder="Breakfast · Appetizers · Main Courses · Desserts"
              />
            </label>
            <label style={field}>
              <span>Dishes (one per line)</span>
              <textarea
                value={s.dishes.join("\n")}
                onChange={(e) => updateSection(i, { dishesText: e.target.value })}
                rows={Math.max(4, s.dishes.length + 1)}
                placeholder={"Butter Croissant\nChocolate Croissant\nGreek Yogurt with Nuts & Honey\nPancakes with Maple Syrup"}
              />
              <small style={{ fontSize: 11, color: "#6b7280", fontStyle: "italic", marginTop: 4 }}>
                {s.dishes.length} dish{s.dishes.length === 1 ? "" : "es"}
              </small>
            </label>
            <button type="button" onClick={() => removeSection(i)} style={removeBtn}>
              × Remove this section
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={addSection} style={btnGhost}>
          + Add another section
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
