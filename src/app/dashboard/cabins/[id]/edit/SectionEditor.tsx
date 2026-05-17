"use client";

// Per-section JSON editor, used by the concierge brief admin
// page. Validates JSON locally before POSTing.

import { useState } from "react";

export default function SectionEditor({
  cabinId,
  sectionKey,
  title,
  initial,
}: {
  cabinId: string;
  sectionKey: string;
  title: string;
  initial: unknown;
}) {
  const [value, setValue] = useState(() => JSON.stringify(initial ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  async function save() {
    setBusy(true);
    setMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (e) {
      setMsg({ ok: false, text: "Invalid JSON: " + (e as Error).message });
      setBusy(false);
      return;
    }
    try {
      const r = await fetch(`/api/cabins/${cabinId}/brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section_key: sectionKey, data: parsed }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "save-failed");
      setMsg({ ok: true, text: `Saved · ${j.overall_percent ?? "?"}% overall · ${j.completed ? "marked complete" : "in progress"}` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{ background: "#fff", border: "1px solid rgba(13,27,42,0.08)" }}
    >
      <summary style={{
        cursor: "pointer", padding: "14px 18px",
        display: "flex", justifyContent: "space-between", gap: 16,
        fontFamily: "Georgia, serif", fontSize: 17,
      }}>
        <span>{title}</span>
        <span style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: open ? "#C9A84C" : "#6b7280" }}>
          {open ? "Editing" : "Tap to edit"}
        </span>
      </summary>

      <div style={{ padding: "0 18px 18px" }}>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={12}
          style={{
            width: "100%",
            fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
            fontSize: 12, padding: 12,
            border: "1px solid rgba(13,27,42,0.18)",
            background: "#fdfdfb",
            color: "#0D1B2A",
          }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            style={{
              background: "#0D1B2A", color: "#F8F5F0",
              padding: "8px 16px", border: "1px solid #C9A84C",
              fontSize: 10, letterSpacing: 2, textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {busy ? "Saving…" : "Save section"}
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
    </details>
  );
}
