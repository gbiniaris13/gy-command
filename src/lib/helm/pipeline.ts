// src/lib/helm/pipeline.ts
// 2026-07-24 — George's Charter Pipeline upgrade, the shared brain:
//
//   • extraction.pipeline = { sent_at, fu[3], notes, wanted_nights }
//     (JSONB inside the existing extraction column — zero migrations)
//   • 3 suggested follow-up dates scaled by how close the charter is.
//     Research (high-ticket cadence, 2026): 80% of closed sales take 5+
//     touches and the day-7 "are we still on?" question is the highest-ROI
//     single move; luxury buyers with a NEAR departure decide in days, a
//     next-season buyer decides over weeks. So:
//         charter ≤ 45 days out   → +2d, +5d, +9d      (hot: they are booking NOW)
//         charter ≤ 120 days out  → +3d, +8d, +16d     (deciding this month)
//         later / unknown dates   → +5d, +14d, +30d    (long lead, stay warm not pushy)
//     F1 and F2 are real follow-ups; F3 is the courteous close ("thank you,
//     at your disposal, perhaps the timing was not right").
//   • George edits any date inline and marks steps done from the pipeline
//     row; follow_up_at (the column the daily cron reads) always mirrors
//     the EARLIEST not-done step, so every existing reminder keeps working.

export type FuStep = {
  due: string; // YYYY-MM-DD
  done_at: string | null; // ISO timestamp when George marked it done
  how: string | null; // 'call' | 'whatsapp' | 'email' | ... (free)
};

export type HelmPipeline = {
  sent_at?: string; // ISO — when the proposal email left for the client
  fu?: FuStep[]; // exactly 3 steps
  notes?: string; // George's own hand-written state of play
  wanted_nights?: number | null; // for flexible windows: what the client actually wants
};

export function readPipeline(extraction: unknown): HelmPipeline {
  if (extraction && typeof extraction === "object" && "pipeline" in (extraction as Record<string, unknown>)) {
    const p = (extraction as Record<string, unknown>).pipeline;
    if (p && typeof p === "object") return p as HelmPipeline;
  }
  return {};
}

/** The urgency-scaled 3-date plan, offsets from the send moment. */
export function suggestFollowUps(sentAtIso: string, charterFromIso: string | null | undefined): FuStep[] {
  const sentMs = Date.parse(sentAtIso);
  const base = Number.isFinite(sentMs) ? sentMs : Date.now();
  let leadDays: number | null = null;
  if (charterFromIso) {
    const from = Date.parse(`${charterFromIso}T00:00:00Z`);
    if (Number.isFinite(from)) leadDays = Math.round((from - base) / 86400000);
  }
  const offsets: [number, number, number] =
    leadDays !== null && leadDays <= 45 ? [2, 5, 9]
    : leadDays !== null && leadDays <= 120 ? [3, 8, 16]
    : [5, 14, 30];
  return offsets.map((d) => ({
    due: new Date(base + d * 86400000).toISOString().slice(0, 10),
    done_at: null,
    how: null,
  }));
}

/** follow_up_at mirror: earliest not-done step, as a timestamp the existing
 *  cron/due logic understands (06:00 UTC ≈ 09:00 Athens). */
export function nextDueTimestamp(fu: FuStep[] | undefined): string | null {
  const undone = (fu ?? []).filter((s) => !s.done_at && s.due).map((s) => s.due).sort();
  return undone[0] ? `${undone[0]}T06:00:00Z` : null;
}

// ── Yacht column labels (George's shorthand, 2026-07-24) ────────────────
//   motor yacht → M/Y · sailing catamaran → S/CAT · sailing yacht → S/Y ·
//   power catamaran → P/CAT
export function yachtPrefix(type: string | null | undefined): string {
  const t = (type || "").toLowerCase();
  if (!t) return "";
  if (t.includes("power") && t.includes("cat")) return "P/CAT";
  if (t.includes("cat")) return "S/CAT";
  if (t.includes("motor") || t.includes("m/y")) return "M/Y";
  if (t.includes("sail") || t.includes("s/y")) return "S/Y";
  if (t.includes("gulet")) return "GULET";
  return "";
}

export function yachtLabel(name: string | null | undefined, type: string | null | undefined): string {
  const n = (name || "").trim();
  if (!n) return "";
  const p = yachtPrefix(type);
  return p ? `${p} ${n}` : n;
}

/** A charter-dates pair that spans a wide window (10+ nights) is a flexible
 *  "some week inside this period" request, not a literal 29-night charter. */
export function isFlexibleWindow(nights: number | null): boolean {
  return nights !== null && nights >= 10;
}
