"use client";

// The Helm — "A new edition for the same client" (George, 18 October 2026).
//
// After an edition has gone out, the conversation moves: the client wants
// motor yachts instead of catamarans, or a better supplier answered. George
// pastes the new supplier email here and chooses one of two buttons:
//
//   Fresh edition      the new yachts REPLACE the current cards
//   Add to this edition the new yachts JOIN the current cards
//
// Both call /api/helm/:id/new-edition, which raises the edition number,
// remembers the previous edition, and leaves the client, the thread and the
// link untouched. The page then reloads at the review step: George confirms
// the numbers, presses Generate, and sends the update in the same thread.

import { useState } from "react";

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  try { return JSON.parse(text); } catch {
    if (r.status === 504) return { error: "The server ran out of time (5 minute ceiling). Nothing was saved and nothing was lost. Paste again and retry." };
    return { error: text.slice(0, 200) || `Request failed (HTTP ${r.status})` };
  }
}

const label: React.CSSProperties = { fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#374151", fontWeight: 700 };
const hintStyle: React.CSSProperties = { fontSize: 12.5, color: "#6b7280", margin: "6px 0 10px", lineHeight: 1.55 };
const btnBase: React.CSSProperties = { padding: "10px 16px", fontSize: 13, letterSpacing: 0.3, border: "1px solid #0D1B2A", borderRadius: 2, cursor: "pointer", fontFamily: "inherit" };
const primaryBtn: React.CSSProperties = { ...btnBase, background: "#0D1B2A", color: "#fff" };
const ghostBtn: React.CSSProperties = { ...btnBase, background: "#fff", color: "#0D1B2A" };

export default function NewEditionPanel({
  requestId,
  editionNo,
  yachtCount,
  history,
}: {
  requestId: string;
  editionNo: number;
  yachtCount: number;
  history: { no: number; closed_at?: string | null; yachts?: string[]; replaced?: boolean }[];
}) {
  const [text, setText] = useState("");
  // "From the emails I imported": the same flow as the first edition (Import
  // from Gmail above, then extract), no paste. The server takes the emails
  // that arrived after the previous edition.
  const [fromImported, setFromImported] = useState(false);
  const [busy, setBusy] = useState<null | "fresh" | "keep">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(keep: boolean) {
    if ((!fromImported && !text.trim()) || busy) return;
    const what = keep
      ? `Add the yachts from this email to edition No. ${editionNo} (the ${yachtCount} current yacht${yachtCount === 1 ? "" : "s"} stay) and open edition No. ${editionNo + 1}?`
      : `Start edition No. ${editionNo + 1} from scratch? The ${yachtCount} current yacht${yachtCount === 1 ? "" : "s"} leave the edition (they stay in the history). The client keeps the same link.`;
    if (!confirm(what)) return;
    setBusy(keep ? "keep" : "fresh"); setError(null); setDone(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/new-edition`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fromImported ? "" : text, keep, useImported: fromImported }),
      });
      const j = await readJson(r);
      if (!r.ok) throw new Error(String(j.error || "new-edition-failed"));
      setDone(`Edition No. ${j.edition_no}: ${j.added} yacht${Number(j.added) === 1 ? "" : "s"} extracted, ${j.total} on the cards. Reloading the cards…`);
      setText("");
      // A full reload: the review panel keeps its cards in memory and a soft
      // refresh left the OLD yachts on screen (George, 19 October 2026).
      window.location.href = `${window.location.pathname}#flow-review`;
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <div style={hintStyle}>
        The client is on <b>edition No. {editionNo}</b> ({yachtCount} yacht{yachtCount === 1 ? "" : "s"}). Paste the new supplier email and choose:
        <b> Fresh edition</b> replaces the yachts, <b>Add to this edition</b> keeps them and adds the new ones.
        Either way the client keeps the same link, the thread and the follow-up plan stay, and you still confirm every number before Generate.
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#0D1B2A", margin: "0 0 10px", cursor: "pointer" }}>
        <input type="checkbox" checked={fromImported} onChange={(e) => setFromImported(e.target.checked)} style={{ marginTop: 3 }} />
        <span>
          <b>From the emails I imported from Gmail</b> (the new supplier replies, imported with the box above, after edition No. {editionNo} went out). No paste needed.
        </span>
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        disabled={fromImported}
        placeholder={fromImported ? "Using the emails imported after the previous edition." : "Paste the new supplier's email here…"}
        style={{ width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", lineHeight: 1.5, borderRadius: 2, opacity: fromImported ? 0.5 : 1 }}
      />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <button type="button" onClick={() => run(false)} disabled={busy !== null || (!fromImported && !text.trim())} style={{ ...primaryBtn, opacity: busy || (!fromImported && !text.trim()) ? 0.55 : 1 }}>
          {busy === "fresh" ? "Extracting the new edition…" : `Fresh edition No. ${editionNo + 1} (replace the yachts)`}
        </button>
        <button type="button" onClick={() => run(true)} disabled={busy !== null || (!fromImported && !text.trim())} style={{ ...ghostBtn, opacity: busy || (!fromImported && !text.trim()) ? 0.55 : 1 }}>
          {busy === "keep" ? "Adding the yachts…" : "Add to this edition (keep the current yachts)"}
        </button>
      </div>
      {error && <div style={{ marginTop: 10, color: "#9B2C2C", fontSize: 13 }}>{error}</div>}
      {done && <div style={{ marginTop: 10, color: "#3A6B47", fontSize: 13 }}>{done}</div>}
      {history.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid rgba(13,27,42,0.08)", paddingTop: 10 }}>
          <div style={label}>Earlier editions</div>
          {history.slice().reverse().map((h, i) => (
            <div key={i} style={{ fontSize: 12.5, color: "#6b7280", marginTop: 6 }}>
              No. {h.no}{h.closed_at ? ` · closed ${String(h.closed_at).slice(0, 10)}` : ""}{h.replaced === false ? " · kept in the next edition" : ""}
              {h.yachts && h.yachts.length ? `: ${h.yachts.join(", ")}` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
