// Sprint 2.2 — AI-generated suggested action per cockpit thread.
//
// Per refocus brief §2.3: "Each row shows a one-line suggested
// action. This is the difference between a list and a strategist."
//
// Examples from the brief:
//   "Reply to Villy's meeting request — offer 3 slots in her 20–24
//    April window (now overdue)"
//   "Send catamaran package to Domenico (committed Monday 4/5)"
//   "Final follow-up on Halilcan — engage or close, this is the
//    last touch"
//
// Generated nightly per top-N threads (cost cap) and cached on the
// contact row (next-touch_suggestion + next_touch_suggestion_at).
// Only regenerated when the inbox state changes meaningfully.

import { aiChat } from "@/lib/ai";

export interface ThreadContext {
  contact_name: string;
  inbox_stage: string;
  gap_days: number;
  last_direction: "inbound" | "outbound" | null;
  last_subject: string | null;
  last_snippet: string | null;
  pipeline_stage: string | null;
  charter_fee: number | null;
  open_commitments: Array<{
    summary: string;
    deadline_date: string | null;
    days_overdue: number;
  }>;
  health_score: number | null;
}

const SYSTEM = `You write a single-line suggested action for George (a yacht broker) based on one inbox thread's state.

CRITICAL OUTPUT RULES:
- Output ONLY raw JSON. NO markdown fences. NO prose.
- Schema: {"suggestion":"<≤120 chars action with rationale in parens>"}

Style:
- Imperative voice: "Reply to X with…", "Send Y package", "Final follow-up on…"
- Reference the specific commitment / deadline / state when present
- Add the "why" in parens: (now overdue), (committed Monday), (last touch before close)
- Greek or English — match the contact's language if obvious
- Never generic ("Follow up with X"). Always specific.

Examples:
- "Reply to Villy's meeting request — offer 3 slots in her 20-24 April window (now overdue)"
- "Send Domenico the catamaran package + Kyllini report (committed Monday 4/5)"
- "Final follow-up on Halilcan — engage or close, this is the last touch"
- "No action needed — Lisa parked herself until end of 2026"`;

export async function suggestAction(
  ctx: ThreadContext,
): Promise<string | null> {
  const userMsg = JSON.stringify(ctx);
  let raw: string;
  try {
    raw = await aiChat(SYSTEM, userMsg, { maxTokens: 200, temperature: 0.4 });
  } catch {
    return null;
  }
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]) as { suggestion?: string };
    if (parsed.suggestion && parsed.suggestion.length > 0) {
      return parsed.suggestion.slice(0, 200);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Composite priority score 0-100 (per brief §2.2).
 * Combines stage band + sentiment + relationship tier + deal value
 * + commitment + parked penalty + decline penalty into a single
 * decision-ready number.
 */
export function compositePriorityScore(ctx: {
  inbox_stage: string;
  gap_days: number;
  starred: boolean;
  pipeline_stage: string | null;
  charter_fee: number | null;
  health_score: number | null;
  has_open_commitment: boolean;
  has_overdue_commitment: boolean;
  parked_until: string | null;
  declined_at: string | null;
}): number {
  if (ctx.declined_at) return 0;
  if (
    ctx.parked_until &&
    new Date(ctx.parked_until) > new Date()
  )
    return 0;

  let s = 0;
  // Stage band (0-40)
  switch (ctx.inbox_stage) {
    case "owed_reply":
      s += ctx.gap_days <= 7 ? 40 : ctx.gap_days <= 30 ? 30 : 20;
      break;
    case "new_lead":
      s += 32;
      break;
    case "needs_followup":
      s += 28;
      break;
    case "cold":
      s += 12;
      break;
    case "active":
      s += 18;
      break;
    case "awaiting_reply":
      s += 8;
      break;
    default:
      s += 5;
  }
  // Star (huge — manual signal)
  if (ctx.starred) s += 25;
  // CRM stage
  const PRIO = new Set([
    "Hot",
    "Warm",
    "Negotiation",
    "Proposal Sent",
    "Meeting Booked",
    "Contract Sent",
    "Closed Won",
  ]);
  if (ctx.pipeline_stage && PRIO.has(ctx.pipeline_stage)) s += 10;
  // Deal money
  if (ctx.charter_fee && ctx.charter_fee > 0) {
    s += Math.min(15, Math.round(Math.log10(ctx.charter_fee + 1) * 2));
  }
  // Health (warming = boost, cooling = lower priority since no
  // immediate action will help)
  if (typeof ctx.health_score === "number") {
    s += Math.round((ctx.health_score - 50) / 10);
  }
  // Open commitment
  if (ctx.has_overdue_commitment) s += 12;
  else if (ctx.has_open_commitment) s += 4;

  return Math.max(0, Math.min(100, s));
}
