// src/lib/helm/pipeline.ts
// 2026-07-24 — George's Charter Pipeline upgrade, the shared brain:
//
//   • extraction.pipeline = { sent_at, fu[], notes, wanted_nights }
//     (JSONB inside the existing extraction column — zero migrations)
//   • A follow-up plan whose LENGTH and SPACING scale with how far away the
//     charter is. See the block above suggestFollowUps for the 2026-08-04
//     rebuild and the evidence behind it. Every plan ends with a courteous
//     close ("thank you, at your disposal, perhaps the timing was not right").
//   • George edits any date inline and marks steps done from the pipeline
//     row; follow_up_at (the column the daily cron reads) always mirrors
//     the EARLIEST not-done step, so every existing reminder keeps working.

export type FuStep = {
  due: string; // YYYY-MM-DD
  done_at: string | null; // ISO timestamp when George marked it done
  how: string | null; // 'call' | 'whatsapp' | 'email' | ... (free)
  // What this step IS. Added 2026-08-04 so the UI and the composer stop
  // guessing from the index: a plan can now be 1 to 6 steps long, and the
  // goodbye is not always the third one.
  //   nudge  = a real follow-up
  //   reopen = coming back after a long park, near the charter
  //   bye    = the courteous close
  kind?: "nudge" | "reopen" | "bye";
};

export type HelmPipeline = {
  sent_at?: string; // ISO — when the proposal email left for the client
  fu?: FuStep[]; // 1 to 6 steps, length set by the lead time (see suggestFollowUps)
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

// 2026-08-04 — cadence rebuilt on measured evidence, and the ladder made as
// long as the wait. What changed and why:
//
//   • The old plan was always THREE steps. For a charter 14 months out that
//     meant +5, +14, +30 days: we said goodbye thirteen months before the
//     client was ever going to decide. That was the bug George felt.
//   • The old comment cited "80% of closed sales take 5+ touches". That figure
//     has NO traceable primary source (checked 2026-08-04) and is dropped.
//     What replaces it is measured: Velocify, 3.5M inbound leads, found that
//     past FIVE emails before first contact conversion falls 36%, and that the
//     best-performing schedule uses EXPANDING gaps. Yesware, 500K emails,
//     found the first follow-up carries almost all the incremental yield.
//     So: never more than five touches, always widening, never weekly.
//   • Long-lead requests now PARK after the fourth touch and re-open ~90 days
//     before the charter, which is when the client can actually decide. The
//     goodbye is the last step, always, whatever the ladder length.
//
// Buckets are finer than before, because "later / unknown" was doing the work
// of everything from four months to two years.
const LADDER: { maxLead: number; offsets: number[] }[] = [
  { maxLead: 30,       offsets: [2, 5, 9, 14] },
  { maxLead: 60,       offsets: [3, 8, 16, 28] },
  { maxLead: 120,      offsets: [3, 10, 24, 45] },
  { maxLead: 240,      offsets: [4, 14, 40, 85] },
  { maxLead: Infinity, offsets: [4, 14, 55, 120] },
];

const GOODBYE_GAP = 21;      // the courteous close, days after the touch before it
const PARK_BEYOND = 150;     // still this far out after touch 4 → park, do not close
const REOPEN_BEFORE = 90;    // come back this many days before the charter

/** Nobody wants a broker's email on Christmas Day or a Sunday. */
function avoidDeadDays(ms: number): number {
  for (let i = 0; i < 20; i++) {
    const d = new Date(ms);
    const m = d.getUTCMonth() + 1, day = d.getUTCDate();
    const dead =
      (m === 12 && day >= 23) ||   // Christmas week
      (m === 1 && day <= 2) ||     // New Year
      (m === 8 && day === 15) ||   // Dekapentavgoustos
      d.getUTCDay() === 0;         // Sunday
    if (!dead) return ms;
    ms += 86400000;
  }
  return ms;
}

/** The urgency-scaled plan. Four nudges then a goodbye, with a park-and-reopen
 *  in the middle when the charter is far enough away to deserve patience.
 *  Returns 3 to 6 steps; the LAST is always the courteous close. */
export function suggestFollowUps(sentAtIso: string, charterFromIso: string | null | undefined): FuStep[] {
  const sentMs = Date.parse(sentAtIso);
  const base = Number.isFinite(sentMs) ? sentMs : Date.now();
  let leadDays: number | null = null;
  let charterMs: number | null = null;
  if (charterFromIso) {
    const from = Date.parse(`${charterFromIso}T00:00:00Z`);
    if (Number.isFinite(from)) { charterMs = from; leadDays = Math.round((from - base) / 86400000); }
  }
  // No date on the request: assume the middle of the road. Chasing someone
  // every few days because a field was left blank is the failure we removed.
  const lead = leadDays ?? 45;
  const row = LADDER.find((l) => lead <= l.maxLead)!;

  const stops: number[] = [];
  for (const off of row.offsets) {
    const t = base + off * 86400000;
    // Never nudge someone who is already aboard.
    if (charterMs !== null && t > charterMs - 3 * 86400000) break;
    stops.push(t);
  }
  // Nothing fitted (charter is days away): keep one honest touch.
  if (stops.length === 0) stops.push(base + 2 * 86400000);

  const last = stops[stops.length - 1];
  const leadAtLast = charterMs === null ? null : Math.round((charterMs - last) / 86400000);

  let reopenAt: number | null = null;
  if (leadAtLast !== null && leadAtLast > PARK_BEYOND) {
    // Park, then come back when the week is close enough to decide on.
    reopenAt = charterMs! - REOPEN_BEFORE * 86400000;
    stops.push(reopenAt);
  }
  // The goodbye, always last, but only if there is room to breathe before it.
  // A charter five days away does not want a farewell note squeezed in beside
  // the only nudge we managed to fit.
  const prev = stops[stops.length - 1];
  let goodbye = prev + GOODBYE_GAP * 86400000;
  if (charterMs !== null) goodbye = Math.min(goodbye, charterMs - 3 * 86400000);
  let byeAt: number | null = null;
  if (goodbye - prev >= 3 * 86400000) { byeAt = goodbye; stops.push(goodbye); }

  return stops.map((t) => {
    const kind: FuStep["kind"] = t === byeAt ? "bye" : t === reopenAt ? "reopen" : "nudge";
    return { due: new Date(avoidDeadDays(t)).toISOString().slice(0, 10), done_at: null, how: null, kind };
  });
}

/** Labels straight off the plan, so the UI never hardcodes a length or
 *  guesses which step is the goodbye. */
export function followUpLabels(fu: FuStep[] | undefined): { short: string; title: string }[] {
  const steps = fu ?? [];
  // Plans created before 2026-08-04 have no `kind` on their steps. For those,
  // fall back to the old convention: the last step was always the goodbye.
  const legacy = steps.length > 0 && steps.every((s) => !s.kind);
  let n = 0;
  return steps.map((s, i) => {
    if (legacy) {
      if (i === steps.length - 1)
        return { short: "Bye", title: "Courteous close: thank you, at your disposal, no pressure" };
      return { short: `F${i + 1}`, title: `Follow-up ${i + 1}` };
    }
    if (s.kind === "bye")
      return { short: "Bye", title: "Courteous close: thank you, at your disposal, no pressure" };
    if (s.kind === "reopen")
      return { short: "Re", title: "Re-open: the week is close enough to decide on now" };
    n += 1;
    return { short: `F${n}`, title: `Follow-up ${n}` };
  });
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
