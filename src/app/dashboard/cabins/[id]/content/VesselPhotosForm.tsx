// gy-command — Vessel photos URL list editor.
//
// 2026-05-20 — Friend-test pass 4 (Tyler, David, Helen):
//   "/cabin/vessel has no photos." The cabins.vessel_photos JSONB
//   array drives the client gallery. This form lets George paste a
//   URL + optional caption per row, in the same shape the client
//   page renders.
//
// Pastes accept whole URLs (https://...) — typically from George's
// public Sanity yacht inventory or any CDN. No upload, just URLs.
"use client";

import { useState } from "react";

type Photo = { url: string; caption?: string; credit?: string };

export default function VesselPhotosForm({
  cabinId,
  initial,
}: {
  cabinId: string;
  initial: Photo[];
}) {
  const [rows, setRows] = useState<Photo[]>(() =>
    Array.isArray(initial) && initial.length > 0
      ? initial.map((p) => ({
          url: typeof p?.url === "string" ? p.url : "",
          caption: typeof p?.caption === "string" ? p.caption : "",
          credit: typeof p?.credit === "string" ? p.credit : "",
        }))
      : [{ url: "", caption: "", credit: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function update(i: number, key: keyof Photo, v: string) {
    setRows((rs) => rs.map((r, ix) => (ix === i ? { ...r, [key]: v } : r)));
  }
  function add() {
    setRows((rs) => [...rs, { url: "", caption: "", credit: "" }]);
  }
  function remove(i: number) {
    setRows((rs) => rs.filter((_, ix) => ix !== i));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    // Drop empty-url rows before saving so blank ones don't render
    // as broken <img>s on the client page.
    const cleaned = rows
      .map((r) => ({
        url: r.url.trim(),
        caption: r.caption?.trim() || undefined,
        credit: r.credit?.trim() || undefined,
      }))
      .filter((r) => r.url.length > 0);
    try {
      const res = await fetch(`/api/cabins/${cabinId}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vessel_photos: cleaned }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "save-failed");
      setMsg({ ok: true, text: `Saved ${cleaned.length} photo${cleaned.length === 1 ? "" : "s"}` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details open style={{ background: "#fff", border: "1px solid rgba(13,27,42,0.08)" }}>
      <summary style={{ cursor: "pointer", padding: "14px 18px", fontFamily: "Georgia, serif", fontSize: 16 }}>
        Vessel photos
      </summary>
      <div style={{ padding: "0 18px 18px" }}>
        <p style={{ fontSize: 12, color: "#6b7280", fontStyle: "italic", margin: "4px 0 14px" }}>
          Paste public photo URLs (https). First row becomes the hero on the client page; the rest fill the rail below. Caption + credit are optional but read elegantly when set.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((r, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: 10,
                alignItems: "start",
                paddingBottom: 12,
                borderBottom: "1px dashed rgba(13,27,42,0.1)",
              }}
            >
              <div style={{ width: 48, height: 36, background: "rgba(13,27,42,0.06)", overflow: "hidden", marginTop: 8 }}>
                {r.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  type="url"
                  value={r.url}
                  onChange={(e) => update(i, "url", e.target.value)}
                  placeholder="https://… photo URL"
                  style={inp}
                />
                <input
                  type="text"
                  value={r.caption || ""}
                  onChange={(e) => update(i, "caption", e.target.value)}
                  placeholder="Caption (optional) — e.g. Sundeck at golden hour"
                  style={inp}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={r.credit || ""}
                    onChange={(e) => update(i, "credit", e.target.value)}
                    placeholder="Photo credit (optional)"
                    style={{ ...inp, flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(13,27,42,0.18)",
                      color: "rgba(13,27,42,0.55)",
                      fontSize: 10,
                      letterSpacing: 1.5,
                      textTransform: "uppercase",
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
          <button
            type="button"
            onClick={add}
            style={{
              background: "transparent",
              border: "1px solid #C9A84C",
              color: "#C9A84C",
              padding: "8px 16px",
              fontSize: 10,
              letterSpacing: 2,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            + Add another
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            style={{
              background: "#0D1B2A",
              color: "#F8F5F0",
              padding: "8px 16px",
              border: "1px solid #C9A84C",
              fontSize: 10,
              letterSpacing: 2,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {busy ? "Saving…" : "Save photos"}
          </button>
          {msg && (
            <span
              style={{
                fontSize: 12,
                color: msg.ok ? "#16a34a" : "#b91c1c",
                fontFamily: "Georgia, serif",
                fontStyle: msg.ok ? "italic" : "normal",
              }}
            >
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </details>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
  fontSize: 12,
  padding: "8px 10px",
  border: "1px solid rgba(13,27,42,0.18)",
  background: "#fdfdfb",
  color: "#0D1B2A",
};
