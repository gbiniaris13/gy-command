"use client";

// Why a request was lost, in one click (George, 25/11/2026): the reason is
// required, chosen from the reasons the November analysis found, with an
// optional line. Stored in helm_requests.lost_reason as "[code] Label · note",
// which After sales reads to send the right note to the right person later.

import { createRoot } from "react-dom/client";
import { useState } from "react";

export const LOST_REASONS: [string, string][] = [
  ["budget", "Budget"],
  ["silence", "Σιωπή, δεν απάντησε"],
  ["short", "Ήθελε ημερήσιο ή λίγες μέρες"],
  ["dates", "Ημερομηνίες ή διαθεσιμότητα"],
  ["plans", "Άλλαξαν σχέδια ή προορισμό"],
  ["broker", "Έκλεισε με άλλον broker"],
  ["personal", "Προσωπικοί λόγοι"],
  ["scope", "Εκτός αντικειμένου (περιοχή, φουσκωτό, transfers)"],
];

function Dialog({ done }: { done: (v: string | null) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const label = LOST_REASONS.find(([c]) => c === code)?.[1];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(13,27,42,0.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => done(null)}>
      <div style={{ background: "#fff", width: 420, maxWidth: "92vw", padding: "20px 22px", border: "1px solid #C9A84C" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#7a6224", marginBottom: 6 }}>Lost</div>
        <div style={{ fontSize: 16, color: "#0D1B2A", marginBottom: 12 }}>Γιατί χάθηκε;</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {LOST_REASONS.map(([c, l]) => (
            <button key={c} onClick={() => setCode(c)} style={{ fontSize: 12.5, padding: "7px 11px", cursor: "pointer", border: `1px solid ${code === c ? "#0D1B2A" : "rgba(13,27,42,0.2)"}`, background: code === c ? "#0D1B2A" : "#fff", color: code === c ? "#F8F5F0" : "#0D1B2A" }}>{l}</button>
          ))}
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Μία γραμμή, αν θες (π.χ. ήθελε ως 12.000)" style={{ width: "100%", marginTop: 14, padding: 9, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit" }} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button onClick={() => done(null)} style={{ background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "8px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Άκυρο</button>
          <button disabled={!code} onClick={() => done(`[${code}] ${label}${note.trim() ? ` · ${note.trim()}` : ""}`)} style={{ background: code ? "#0D1B2A" : "#9CA3AF", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "8px 16px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: code ? "pointer" : "not-allowed" }}>Lost</button>
        </div>
      </div>
    </div>
  );
}

/** Ask why; resolves to the stored text, or null if George cancelled. */
export function chooseLostReason(): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: string | null) => { root.unmount(); host.remove(); resolve(v); };
    root.render(<Dialog done={done} />);
  });
}
