// GY Cockpit — central decision engine.
//
// One file that powers the entire morning briefing + dashboard. Reads
// the live CRM state from Supabase, scores every active contact for
// charter probability, ranks today's high-impact actions, surfaces
// proactive opportunities, and exports everything as a single
// CockpitBriefing object the UI + Telegram cron consume.
//
// Design principles:
//   - "Action over data" — ranks actions, not contacts. Tells George
//     what to do, not what to look at.
//   - "Money first" — every action has expected commission impact in
//     EUR. Sort by money, not freshness.
//   - "Self-cleaning" — actions auto-resolve when activity is logged
//     against the contact (no manual checkboxes).
//   - "Mobile context" — output structure is identical for UI + push
//     notifications. One source of truth.
//
// Reads (Supabase):
//   contacts, pipeline_stages, activities, settings, ig_posts
// Writes (Supabase):
//   settings.cockpit_briefing_<date> — daily snapshot for replay
//
// AI provider: Gemini 2.5 Flash via lib/ai.ts (free tier).

import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat } from "@/lib/ai";
import type { InboxStage } from "@/lib/inbox-analyzer";

// ─── TYPES ──────────────────────────────────────────────────────────

export type ActionPriority = "critical" | "high" | "medium" | "low";

export interface CockpitAction {
  id: string;                       // contact_id-based stable id
  priority: ActionPriority;
  title: string;                    // "Follow up Halilcan — €235K, 14d silent"
  contact_id: string;
  contact_name: string;
  contact_email: string | null;
  reason: string;                   // why this is on the list
  expected_commission_eur: number;  // money at stake (0 if not a deal)
  days_stale: number;
  stage: string | null;
  draft_kind: "follow_up" | "reengage" | "proposal_chase" | "intro" | "thank_you";
  vessel: string | null;
  charter_dates: string | null;
}

export interface PipelinePulse {
  total_pipeline_value_eur: number;
  total_commission_upside_eur: number;
  active_deals_count: number;
  pending_payments_count: number;
  pending_payments_eur: number;
  stale_warm_leads_count: number;
  hot_leads_count: number;
  contacts_total: number;
  // Direction signals (positive = good)
  net_change_today: {
    new_inquiries: number;
    closed_won_value_eur: number;
    activity_count: number;
  };
}

export interface CockpitOpportunity {
  kind:
    | "email_opened"
    | "calendar_today"
    | "ig_warm_signal"
    | "stale_b2b_partner"
    | "press_mention"
    | "competitor_movement"
    | "season_window";
  title: string;
  detail: string;
  contact_id?: string | null;
  link?: string | null;
}

export interface InboxThread {
  contact_id: string;
  contact_name: string;
  contact_email: string | null;
  inbox_stage: InboxStage;
  gap_days: number | null;
  last_direction: "inbound" | "outbound" | null;
  last_subject: string | null;
  last_snippet: string | null;
  thread_id: string | null;
  pipeline_stage: string | null;
  charter_fee: number | null;
  /** Sprint 2.1 Bug 9 — single-source cockpit. Threads with an
   *  associated deal carry the commission upside so the UI can
   *  show a 💰 badge inline and drop the separate CRM-action
   *  section. */
  expected_commission_eur: number | null;
  vessel: string | null;
  charter_dates: string | null;
  suggested_action: "reply" | "follow_up" | "wait";
  /** True if George has starred any thread with this contact in Gmail. */
  starred: boolean;
  /** Pillar 5 — relationship health 0-100 (null if not yet scored). */
  health_score: number | null;
  health_trend: "up" | "down" | "flat" | null;
  /** Sprint 2.2 — AI-generated one-liner: "Reply to Villy's meeting
   *  request — offer 3 slots in her 20-24 April window (now overdue)" */
  suggestion: string | null;
  /** Sprint 2.2 — composite 0-100 (separate from rank_score). */
  composite_priority: number | null;
  /** Higher = more urgent. Lets the UI sort & color a flat list. */
  rank_score: number;
}

export interface InboxSummary {
  owed_reply: number;
  needs_followup: number;
  awaiting_reply: number;
  active: number;
  cold: number;
  new_lead: number;
}

export interface GreetingsReady {
  count_for_tomorrow: number;
  by_kind: Record<string, number>;
  gmail_label_url: string;
}

export interface CommitmentRow {
  id: string;
  contact_id: string;
  contact_name: string;
  contact_email: string | null;
  thread_id: string | null;
  commitment_summary: string;
  deadline_date: string | null;
  deadline_phrase: string | null;
  source_sent_at: string;
  /** "overdue_severe" (>7d) | "overdue" (1-7d) | "today" | "upcoming" | "no_deadline" */
  bucket: "overdue_severe" | "overdue" | "today" | "upcoming" | "no_deadline";
  days_overdue: number;
}

export interface CommitmentsReady {
  total_open: number;
  overdue_count: number;
  due_today_count: number;
  rows: CommitmentRow[];
}

export interface CockpitBriefing {
  generated_at: string;
  greeting: string;
  actions: CockpitAction[];
  /** Pillar 1 — Gmail-derived thread state, ranked. The cockpit's
   *  primary surface: every thread that needs George today. */
  inbox_threads: InboxThread[];
  inbox_summary: InboxSummary;
  pulse: PipelinePulse;
  opportunities: CockpitOpportunity[];
  /** Pillar 3 — drafts ready for tomorrow's birthdays/name-days/
   *  holidays. Surfaced so George has a one-click bulk-review path. */
  greetings_ready: GreetingsReady;
  /** Pillar 4 (Sprint 2.3) — promises George made to contacts that
   *  still need fulfilling. Top of cockpit when present — broken
   *  promises erode trust. */
  commitments_ready: CommitmentsReady;
  brainstorm_prompt: string;
  /** Daily contrarian/devil's-advocate question. Uninvited, provocative,
   *  forces strategic reflection. Generated by AI from live data. */
  devils_advocate: string;
  meta: {
    source_contacts: number;
    ranking_method: "ai" | "heuristic";
  };
}

// ─── HELPERS ────────────────────────────────────────────────────────

const ACTIVE_STAGES = [
  "Hot",
  "Warm",
  "Negotiation",
  "Proposal Sent",
  "Meeting Booked",
  "Contract Sent",
];

const BIG_OPPORTUNITY_STAGES = ["Proposal Sent", "Negotiation", "Contract Sent"];

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return 999;
  return Math.max(0, Math.floor((Date.now() - d) / 86_400_000));
}

function nameOf(c: { first_name?: string | null; last_name?: string | null; email?: string | null }) {
  const n = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return n || c.email || "—";
}

function athensGreeting(): string {
  const hour = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Athens" }),
  ).getHours();
  if (hour < 12) return "Good morning, George.";
  if (hour < 18) return "Good afternoon, George.";
  return "Good evening, George.";
}

// ─── SCORING ────────────────────────────────────────────────────────

/**
 * Charter probability score 0-100. Pure heuristic — fast, transparent,
 * no AI call. AI only used to RANK actions (different problem).
 */
export function scoreContact(c: {
  charter_fee?: number | null;
  payment_status?: string | null;
  pipeline_stage_name?: string | null;
  last_activity_at?: string | null;
}): number {
  const stage = c.pipeline_stage_name || "";
  let score = 0;

  // Stage weight (the dominant signal)
  if (stage === "Closed Won") score = 100;
  else if (stage === "Contract Sent") score = 85;
  else if (stage === "Negotiation") score = 70;
  else if (stage === "Proposal Sent") score = 55;
  else if (stage === "Meeting Booked") score = 50;
  else if (stage === "Hot") score = 40;
  else if (stage === "Warm") score = 25;
  else if (stage === "Contacted") score = 10;
  else score = 5;

  // Has charter_fee = serious signal
  if ((c.charter_fee || 0) > 0) score += 15;

  // Payment status = trust ladder
  if (c.payment_status === "paid") score = Math.max(score, 95);
  else if (c.payment_status === "partial") score = Math.max(score, 80);

  // Stale penalty
  const stale = daysSince(c.last_activity_at ?? null);
  if (stale > 30) score -= 25;
  else if (stale > 14) score -= 15;
  else if (stale > 7) score -= 5;

  return Math.max(0, Math.min(100, score));
}

// ─── ACTION RANKING (heuristic-first, AI-augmented) ─────────────────

interface RawCandidate {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  charter_fee: number | null;
  commission_earned: number | null;
  charter_vessel: string | null;
  charter_start_date: string | null;
  charter_end_date: string | null;
  payment_status: string | null;
  last_activity_at: string | null;
  pipeline_stage_name: string | null;
}

function impactScore(c: RawCandidate): number {
  // money component
  const money =
    (c.commission_earned || 0) * 1.0 +
    (c.charter_fee || 0) * 0.05; // tiny fraction so commission dominates
  // urgency component (stale × stage criticality)
  const stale = daysSince(c.last_activity_at);
  const isCritical = BIG_OPPORTUNITY_STAGES.includes(c.pipeline_stage_name || "");
  const urgency = (isCritical ? 10 : 1) * Math.min(30, stale);
  return money + urgency * 100;
}

function priorityFromScore(score: number, c: RawCandidate): ActionPriority {
  if ((c.charter_fee || 0) > 100_000 && BIG_OPPORTUNITY_STAGES.includes(c.pipeline_stage_name || "")) {
    return "critical";
  }
  if (score > 30_000) return "critical";
  if (score > 10_000) return "high";
  if (score > 2_000) return "medium";
  return "low";
}

function draftKindFor(c: RawCandidate): CockpitAction["draft_kind"] {
  const stage = c.pipeline_stage_name || "";
  if (stage === "Proposal Sent" || stage === "Negotiation") return "proposal_chase";
  if (stage === "Closed Won") return "thank_you";
  if (stage === "Contacted") return "intro";
  if (stage === "Warm" || stage === "Hot") {
    return daysSince(c.last_activity_at) > 14 ? "reengage" : "follow_up";
  }
  return "follow_up";
}

function reasonFor(c: RawCandidate): string {
  const stale = daysSince(c.last_activity_at);
  const stage = c.pipeline_stage_name || "Unknown";
  const fee = c.charter_fee || 0;
  if (stage === "Proposal Sent" && stale > 7 && fee > 0) {
    return `Proposal για €${fee.toLocaleString()} σιωπηλό ${stale} μέρες — άμεσος follow-up πριν χαθεί η ευκαιρία.`;
  }
  if (stage === "Negotiation" && stale > 5) {
    return `Negotiation κρύωσε ${stale} μέρες. Επανέναρξη πριν πάει σε άλλο broker.`;
  }
  if (stage === "Warm" && stale > 14) {
    return `Warm B2B/lead ${stale} μέρες χωρίς activity. Re-engage με value-add.`;
  }
  if (stage === "Hot" && stale > 3) {
    return `HOT lead ${stale} μέρες — every hour matters σε hot leads.`;
  }
  if (stage === "Meeting Booked" && stale > 2) {
    return `Meeting booked, αλλά no recent prep activity. Confirm + brief.`;
  }
  return `${stage} contact, ${stale} μέρες stale.`;
}

// ─── INBOX THREAD RANKING (Pillar 1) ────────────────────────────────

interface InboxRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  charter_fee: number | null;
  pipeline_stage_name: string | null;
  inbox_inferred_stage: InboxStage | null;
  inbox_gap_days: number | null;
  inbox_last_direction: "inbound" | "outbound" | null;
  inbox_last_subject: string | null;
  inbox_last_snippet: string | null;
  inbox_thread_id: string | null;
  inbox_starred: boolean | null;
  /** Sprint 2.1 — lifecycle suppression. */
  parked_until: string | null;
  declined_at: string | null;
  lifecycle_state: string | null;
  /** Sprint 2.4 — Pillar 5 health score. */
  health_score: number | null;
  health_score_trend: string | null;
  /** Sprint 2.2 — cached AI suggestion + composite priority. */
  next_touch_suggestion: string | null;
  composite_priority_score: number | null;
}

function suggestedActionFor(stage: InboxStage): "reply" | "follow_up" | "wait" {
  if (stage === "owed_reply") return "reply";
  if (stage === "needs_followup" || stage === "cold") return "follow_up";
  if (stage === "active" || stage === "new_lead") return "follow_up";
  return "wait"; // awaiting_reply, unknown
}

// CRM stages that signal "George cares about this person" — boost
// them so they always surface above noise of equal stage.
const PRIORITY_CRM_STAGES = new Set([
  "Hot",
  "Warm",
  "Negotiation",
  "Proposal Sent",
  "Meeting Booked",
  "Contract Sent",
  "Closed Won",
]);

// Auto-reply / out-of-office subject patterns. Threads stuck in
// owed_reply just because the contact's vacation auto-responder fired
// shouldn't outrank real owed-reply threads — they need a calendar
// follow-up after the return date, not an immediate reply.
const AUTO_REPLY_SUBJECT_RE =
  /\b(automatic\s+reply|auto\s*[-_]?\s*reply|out\s+of\s+office|out\s+of\s+the\s+office|away\s+from\s+the\s+office|thank\s+you\s+for\s+reaching\s+out|currently\s+out|will\s+be\s+out\s+of\s+office)\b/i;

function isAutoReplyThread(row: InboxRow): boolean {
  const subj = row.inbox_last_subject ?? "";
  return AUTO_REPLY_SUBJECT_RE.test(subj);
}

/**
 * Rank score for inbox threads. Higher = more urgent.
 *
 * Order encoded:
 *   1. fresh owed_reply (gap ≤ 7d)       — conversation still warm
 *   2. new_lead                           — first-touch leads
 *   3. medium owed_reply (gap 7-30d)      — needs nudge
 *   4. needs_followup                     — silent 7-30d, George sent last
 *   5. stale owed_reply (gap 30-60d)      — likely needs re-engage, not reply
 *   6. cold                               — silent 30d+ (deals only)
 *   7. active                             — informational
 *   8. awaiting_reply / very stale owed   — informational
 *
 * Modifiers:
 *   + 200_000 if contact is in a priority CRM stage (Hot/Warm/etc)
 *   - 600_000 if subject looks like an auto-reply / OOO
 *   + deal value as tie-breakers within each band
 */
function inboxRankScore(row: InboxRow): number {
  const stage = row.inbox_inferred_stage ?? "unknown";
  const gap = row.inbox_gap_days ?? 0;
  const fee = row.charter_fee ?? 0;

  let base: number;
  switch (stage) {
    case "owed_reply":
      // Banded by gap. Fresh owed (today/yesterday) ranks ABOVE
      // old owed (3-month-old auto-reply) — the conversation is
      // still warm, the reply is high-leverage.
      if (gap <= 7) {
        base = 1_000_000 + (7 - gap) * 5_000;
      } else if (gap <= 30) {
        base = 600_000 - (gap - 7) * 500;
      } else if (gap <= 60) {
        base = 300_000 - (gap - 30) * 200;
      } else {
        base = 80_000;
      }
      break;
    case "new_lead":
      base = 700_000 + Math.min(fee, 1_000_000) * 0.5;
      break;
    case "needs_followup":
      base = 500_000 + Math.min(fee, 1_000_000) * 0.5 + Math.min(gap, 30) * 100;
      break;
    case "cold":
      base = 200_000 + Math.min(fee, 1_000_000) * 0.2;
      break;
    case "active":
      base = 50_000;
      break;
    case "awaiting_reply":
      base = 10_000;
      break;
    default:
      base = 0;
  }

  // CRM stage boost: people George has actively curated rank above
  // unvetted contacts of the same inbox stage.
  if (
    row.pipeline_stage_name &&
    PRIORITY_CRM_STAGES.has(row.pipeline_stage_name)
  ) {
    base += 200_000;
  }

  // Auto-reply penalty: shift the thread down a tier.
  if (isAutoReplyThread(row)) {
    base -= 600_000;
  }

  // Pillar 1.5 — Gmail STAR boost. George's manual signal beats every
  // heuristic. A starred contact rockets to the absolute top regardless
  // of stage / gap / CRM. He stars threads he wants to keep eyes on.
  if (row.inbox_starred) {
    base += 5_000_000;
  }

  // Sprint 2.1 Bug 9 — single-source cockpit. Threads with an
  // associated deal (charter_fee > 0) get a money boost so the
  // separate "Σήμερα κάνε αυτά" CRM section can be retired.
  if (fee > 0) {
    base += 100_000 + Math.min(fee, 1_000_000) * 0.3;
  }

  return base;
}

const INBOX_SURFACEABLE: InboxStage[] = [
  "owed_reply",
  "needs_followup",
  "cold",
  "new_lead",
  "awaiting_reply",
  "active",
];

async function buildInboxThreads(
  sb: SupabaseClient,
  stageById: Map<string, string>,
): Promise<{ threads: InboxThread[]; summary: InboxSummary }> {
  // Sprint 2.4 — defensive against missing columns. Health-score
  // migration is pending; if those columns don't exist yet, fall
  // back to the wider-known set so the cockpit doesn't go blank.
  const FULL_COLS =
    "id, first_name, last_name, email, charter_fee, commission_earned, charter_vessel, charter_start_date, charter_end_date, pipeline_stage_id, inbox_inferred_stage, inbox_gap_days, inbox_last_direction, inbox_last_subject, inbox_last_snippet, inbox_thread_id, inbox_starred, parked_until, declined_at, lifecycle_state, health_score, health_score_trend, next_touch_suggestion, composite_priority_score";
  const FALLBACK_COLS =
    "id, first_name, last_name, email, charter_fee, commission_earned, charter_vessel, charter_start_date, charter_end_date, pipeline_stage_id, inbox_inferred_stage, inbox_gap_days, inbox_last_direction, inbox_last_subject, inbox_last_snippet, inbox_thread_id, inbox_starred, parked_until, declined_at, lifecycle_state";

  let rows: unknown[] | null = null;
  {
    const r = await sb
      .from("contacts")
      .select(FULL_COLS)
      .not("inbox_inferred_stage", "is", null)
      .neq("inbox_inferred_stage", "unknown")
      .limit(2000);
    if (r.error) {
      const r2 = await sb
        .from("contacts")
        .select(FALLBACK_COLS)
        .not("inbox_inferred_stage", "is", null)
        .neq("inbox_inferred_stage", "unknown")
        .limit(2000);
      rows = r2.data;
    } else {
      rows = r.data;
    }
  }

  const enriched: InboxRow[] = (rows ?? []).map((c: any) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    charter_fee: c.charter_fee,
    pipeline_stage_name: c.pipeline_stage_id ? stageById.get(c.pipeline_stage_id) ?? null : null,
    inbox_inferred_stage: c.inbox_inferred_stage,
    inbox_gap_days: c.inbox_gap_days,
    inbox_last_direction: c.inbox_last_direction,
    inbox_last_subject: c.inbox_last_subject,
    inbox_last_snippet: c.inbox_last_snippet,
    inbox_thread_id: c.inbox_thread_id,
    inbox_starred: c.inbox_starred ?? false,
    parked_until: c.parked_until,
    declined_at: c.declined_at,
    lifecycle_state: c.lifecycle_state,
    health_score: c.health_score ?? null,
    health_score_trend: c.health_score_trend ?? null,
    next_touch_suggestion: c.next_touch_suggestion ?? null,
    composite_priority_score: c.composite_priority_score ?? null,
  }));

  const summary: InboxSummary = {
    owed_reply: 0,
    needs_followup: 0,
    awaiting_reply: 0,
    active: 0,
    cold: 0,
    new_lead: 0,
  };
  for (const r of enriched) {
    const s = r.inbox_inferred_stage;
    if (s && s in summary) (summary as any)[s]++;
  }

  // Sprint 2.1 — lifecycle filter (Bugs 5, 6, 7).
  // Suppress contacts whose state explicitly says "no action needed":
  //   - declined: explicit no, conversation over
  //   - parked: contact self-parked, until parked_until passes
  //   - long-tail OWED: 90+ days = stale, 180+ = closed_no_response
  const todayISO = new Date().toISOString().slice(0, 10);
  const surfaceable = enriched.filter((r) => {
    if (!r.inbox_inferred_stage) return false;
    if (!INBOX_SURFACEABLE.includes(r.inbox_inferred_stage)) return false;

    // Bug 5: declined contacts are over.
    if (r.declined_at || r.lifecycle_state === "declined") return false;

    // Bug 6: parked contacts re-emerge automatically when
    // parked_until passes.
    if (r.parked_until && r.parked_until > todayISO) return false;

    // Bug 7: long-tail OWED auto-archive.
    const gap = r.inbox_gap_days ?? 0;
    if (r.inbox_inferred_stage === "owed_reply" && gap > 180) return false;
    // 90-180 day owed remain visible but downranked via score band.

    return true;
  });

  const ranked = surfaceable
    .map((r) => ({ r, score: inboxRankScore(r) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);

  const threads: InboxThread[] = ranked.map(({ r, score }) => {
    const anyR = r as InboxRow & {
      commission_earned?: number | null;
      charter_vessel?: string | null;
      charter_start_date?: string | null;
      charter_end_date?: string | null;
    };
    const dates =
      anyR.charter_start_date && anyR.charter_end_date
        ? `${anyR.charter_start_date} → ${anyR.charter_end_date}`
        : anyR.charter_start_date ?? null;
    return {
      contact_id: r.id,
      contact_name: nameOf(r),
      contact_email: r.email,
      inbox_stage: r.inbox_inferred_stage as InboxStage,
      gap_days: r.inbox_gap_days,
      last_direction: r.inbox_last_direction,
      last_subject: r.inbox_last_subject,
      last_snippet: r.inbox_last_snippet,
      thread_id: r.inbox_thread_id,
      pipeline_stage: r.pipeline_stage_name,
      charter_fee: r.charter_fee,
      expected_commission_eur: anyR.commission_earned ?? null,
      vessel: anyR.charter_vessel ?? null,
      charter_dates: dates,
      suggested_action: suggestedActionFor(r.inbox_inferred_stage as InboxStage),
      starred: !!r.inbox_starred,
      health_score: r.health_score,
      health_trend:
        (r.health_score_trend as "up" | "down" | "flat" | null) ?? null,
      suggestion: r.next_touch_suggestion,
      composite_priority: r.composite_priority_score,
      rank_score: score,
    };
  });

  return { threads, summary };
}

// ─── MAIN: BUILD BRIEFING ───────────────────────────────────────────

export async function buildBriefing(sb: SupabaseClient): Promise<CockpitBriefing> {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Pull stages once for FK resolution
  const { data: stages } = await sb.from("pipeline_stages").select("id, name");
  const stageById = new Map<string, string>();
  for (const s of stages ?? []) stageById.set(s.id, s.name);

  // 1b. Pillar 1 — pull ranked inbox threads (Gmail thread state).
  // This is the cockpit's primary surface; runs in parallel with the
  // legacy CRM-stage actions below so neither blocks the other.
  const inboxPromise = buildInboxThreads(sb, stageById).catch((e) => {
    console.error("[cockpit-engine] inbox threads failed:", e);
    return {
      threads: [] as InboxThread[],
      summary: {
        owed_reply: 0,
        needs_followup: 0,
        awaiting_reply: 0,
        active: 0,
        cold: 0,
        new_lead: 0,
      } satisfies InboxSummary,
    };
  });

  // 2. Pull all contacts with denormalized deal fields + recent activity
  const activeStageIds = (stages ?? [])
    .filter((s: any) => ACTIVE_STAGES.includes(s.name))
    .map((s: any) => s.id);

  const { data: candidates } = await sb
    .from("contacts")
    .select(
      "id, first_name, last_name, email, charter_fee, commission_earned, charter_vessel, charter_start_date, charter_end_date, payment_status, last_activity_at, pipeline_stage_id",
    )
    .or(
      `pipeline_stage_id.in.(${activeStageIds.join(",") || "0"}),charter_fee.gt.0`,
    )
    .limit(500);

  // 3. Build raw candidates
  const raw: RawCandidate[] = (candidates ?? []).map((c: any) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    charter_fee: c.charter_fee,
    commission_earned: c.commission_earned,
    charter_vessel: c.charter_vessel,
    charter_start_date: c.charter_start_date,
    charter_end_date: c.charter_end_date,
    payment_status: c.payment_status,
    last_activity_at: c.last_activity_at,
    pipeline_stage_name: stageById.get(c.pipeline_stage_id) ?? null,
  }));

  // 4. Filter to actionable: stale OR critical-stage OR has charter_fee
  const actionable = raw.filter((c) => {
    const stale = daysSince(c.last_activity_at);
    const isCritical = BIG_OPPORTUNITY_STAGES.includes(c.pipeline_stage_name || "");
    return stale >= 3 || isCritical || (c.charter_fee || 0) > 0;
  });

  // 5. Score and rank
  const ranked = actionable
    .map((c) => ({ c, score: impactScore(c) }))
    .sort((a, b) => b.score - a.score);

  // 6. Top 3 actions (the heart of the cockpit)
  const top3 = ranked.slice(0, 3);
  const actions: CockpitAction[] = top3.map(({ c, score }) => {
    const dates =
      c.charter_start_date && c.charter_end_date
        ? `${c.charter_start_date} → ${c.charter_end_date}`
        : c.charter_start_date || null;
    return {
      id: `action_${c.id}`,
      priority: priorityFromScore(score, c),
      title:
        c.charter_fee && c.charter_fee > 0
          ? `Follow up ${nameOf(c)} — €${c.charter_fee.toLocaleString()}, ${daysSince(c.last_activity_at)}d silent`
          : `Re-engage ${nameOf(c)} — ${c.pipeline_stage_name ?? "active"}, ${daysSince(c.last_activity_at)}d stale`,
      contact_id: c.id,
      contact_name: nameOf(c),
      contact_email: c.email,
      reason: reasonFor(c),
      expected_commission_eur: c.commission_earned || 0,
      days_stale: daysSince(c.last_activity_at),
      stage: c.pipeline_stage_name,
      draft_kind: draftKindFor(c),
      vessel: c.charter_vessel,
      charter_dates: dates,
    };
  });

  // 7. Pipeline pulse — single source of truth numbers
  const allDeals = raw.filter((c) => (c.charter_fee || 0) > 0);
  const totalPipelineValue = allDeals.reduce((s, c) => s + (c.charter_fee || 0), 0);
  const totalCommissionUpside = allDeals.reduce(
    (s, c) => s + (c.commission_earned || 0),
    0,
  );
  // Pending payments = ACTUAL invoiced-but-unpaid amounts. Only count
  // contacts where a contract has been signed (stage in Contract Sent /
  // Closed Won / Negotiation). Proposal Sent contacts default to
  // payment_status='pending' in the DB schema, but that's NOT an
  // outstanding invoice — it's just a default value because the
  // proposal hasn't been signed. Counting those as "pending payments"
  // misleads the operator (per George's 25/04 feedback).
  const PAYMENT_PENDING_STAGES = ["Contract Sent", "Closed Won", "Negotiation"];
  const pendingPayments = allDeals.filter(
    (c) =>
      (c.payment_status ?? "").toLowerCase() === "pending" &&
      PAYMENT_PENDING_STAGES.includes(c.pipeline_stage_name || ""),
  );
  const pendingPaymentsEur = pendingPayments.reduce(
    (s, c) => s + (c.charter_fee || 0),
    0,
  );

  // Activity today
  const dayStart = new Date(today + "T00:00:00Z").toISOString();
  const { count: activityToday } = await sb
    .from("activities")
    .select("id", { count: "exact", head: true })
    .gte("created_at", dayStart);

  const { count: contactsTotal } = await sb
    .from("contacts")
    .select("id", { count: "exact", head: true });

  const hotCount = raw.filter((c) => c.pipeline_stage_name === "Hot").length;
  const staleWarmCount = raw.filter((c) => {
    return c.pipeline_stage_name === "Warm" && daysSince(c.last_activity_at) >= 7;
  }).length;

  const pulse: PipelinePulse = {
    total_pipeline_value_eur: totalPipelineValue,
    total_commission_upside_eur: totalCommissionUpside,
    active_deals_count: allDeals.length,
    pending_payments_count: pendingPayments.length,
    pending_payments_eur: pendingPaymentsEur,
    stale_warm_leads_count: staleWarmCount,
    hot_leads_count: hotCount,
    contacts_total: contactsTotal ?? 0,
    net_change_today: {
      new_inquiries: 0, // populated below if we have time
      closed_won_value_eur: 0,
      activity_count: activityToday ?? 0,
    },
  };

  // 8. Opportunities — proactive intelligence layer
  const opportunities: CockpitOpportunity[] = [];

  // Calendar today
  const { data: todayEvents } = await sb
    .from("calendar_events")
    .select("title, start_time, attendees")
    .gte("start_time", dayStart)
    .lte("start_time", today + "T23:59:59Z")
    .limit(5);
  for (const ev of todayEvents ?? []) {
    opportunities.push({
      kind: "calendar_today",
      title: `Σήμερα: ${ev.title}`,
      detail: `${new Date(ev.start_time).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" })} · Athens`,
    });
  }

  // Stale B2B partners (Greek charter agencies)
  const b2bDomains = ["kavas", "istion", "fyly", "ekkayachts", "unforgettablegreece", "starrluxurycars"];
  const staleB2B = raw.filter((c) => {
    if (daysSince(c.last_activity_at) < 7) return false;
    const dom = (c.email || "").toLowerCase();
    return b2bDomains.some((d) => dom.includes(d));
  });
  if (staleB2B.length > 0) {
    opportunities.push({
      kind: "stale_b2b_partner",
      title: `${staleB2B.length} Greek B2B partners σιωπηλοί 7+ μέρες`,
      detail: `${staleB2B.slice(0, 3).map((c) => nameOf(c)).join(", ")}${staleB2B.length > 3 ? ` +${staleB2B.length - 3} άλλοι` : ""}. Re-engagement value-add (νέο fleet listing, market update).`,
    });
  }

  // Charter season window
  const now = new Date();
  const month = now.getMonth() + 1;
  if (month >= 3 && month <= 5) {
    opportunities.push({
      kind: "season_window",
      title: "Πικ booking window — Άνοιξη",
      detail: "Άνοιξη + Καλοκαίρι Mar-May = critical period για 2026 charter bookings. UHNW clients confirm-άρουν August dates τώρα. Push proposals + follow-ups με urgency.",
    });
  }

  // 9. Brainstorm prompt — AI-suggested question for today
  let brainstormPrompt = "What's the highest-leverage move I can make today?";
  try {
    const sys = `You are George Yachts' AI advisor. George is a working broker building his brokerage. Today's pipeline: €${totalPipelineValue.toLocaleString()} active, ${allDeals.length} deals, ${actions.length} prioritized actions. Suggest ONE sharp brainstorm question for today — should provoke insight, not just list options. Greek or English, broker-tone. Max 15 words. No quotes.`;
    const userMsg = `Top action today: ${actions[0]?.title || "no actions"}. Stale B2B count: ${staleB2B.length}. Suggest one brainstorm question.`;
    const out = await aiChat(sys, userMsg, { maxTokens: 60, temperature: 0.7 });
    if (out && out.length < 200) brainstormPrompt = out.trim().replace(/^["']|["']$/g, "");
  } catch {
    /* fallback prompt is fine */
  }

  // 10. Devil's Advocate — provocative contrarian challenge based on
  // today's actual data. Uninvited, calls out blind spots, forces
  // honest re-examination. NOT motivational. Sharp.
  let devilsAdvocate =
    "Είναι πραγματικά ο Halilcan stuck — ή εσύ είσαι αυτός που αποφεύγει την επόμενη επαφή?";
  try {
    const sys = `You are George Yachts' devil's advocate. NOT a coach. Your job: surface the blind spot, challenge the comfortable narrative, ask the question George doesn't want to hear.

Constraints:
- ONE question or sharp observation. Max 30 words.
- Reference specific live data when possible (numbers, names, stages)
- Contrarian to George's likely default move
- Greek or English (mirror context)
- NO motivational fluff, NO emojis, NO "you got this"
- Often the form is: "[uncomfortable observation]. [pointed question]?"
- Goal: make George stop and re-examine, not feel good`;

    const userCtx = `Live data:
- Pipeline: €${totalPipelineValue.toLocaleString()}, ${allDeals.length} deals
- Top action: ${actions[0]?.title || "none"}
- Top action reason: ${actions[0]?.reason || "—"}
- Stale B2B Greek partners: ${staleB2B.length} silent 7+ days
- Hot leads: ${hotCount}
- Activities logged today: ${activityToday ?? 0}
- Contacts in CRM: ${contactsTotal ?? 0}
- Brokerage age: ~5 months (founded late 2025)

Generate ONE devil's-advocate provocation for George. NOT a coaching prompt — a challenge.`;

    const out = await aiChat(sys, userCtx, { maxTokens: 80, temperature: 0.85 });
    if (out && out.trim().length > 10 && out.trim().length < 250) {
      devilsAdvocate = out.trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fallback is fine */
  }

  const inbox = await inboxPromise;

  // Pillar 4 — open commitments grouped by deadline status.
  let commitmentsReady: CommitmentsReady = {
    total_open: 0,
    overdue_count: 0,
    due_today_count: 0,
    rows: [],
  };
  try {
    const { data: open } = await sb
      .from("commitments")
      .select(
        "id, contact_id, thread_id, commitment_summary, deadline_date, deadline_phrase, source_sent_at, contact:contacts(first_name, last_name, email)",
      )
      .is("fulfilled_at", null)
      .is("dismissed_at", null)
      .order("deadline_date", { ascending: true, nullsFirst: false })
      .limit(50);
    type RawRow = {
      id: string;
      contact_id: string;
      thread_id: string | null;
      commitment_summary: string | null;
      deadline_date: string | null;
      deadline_phrase: string | null;
      source_sent_at: string;
      contact: {
        first_name: string | null;
        last_name: string | null;
        email: string | null;
      } | null;
    };
    const rows: CommitmentRow[] = (open ?? []).map((c) => {
      const r = c as unknown as RawRow;
      const name =
        `${r.contact?.first_name ?? ""} ${r.contact?.last_name ?? ""}`.trim() ||
        (r.contact?.email ?? "—");
      let bucket: CommitmentRow["bucket"];
      let daysOverdue = 0;
      if (!r.deadline_date) bucket = "no_deadline";
      else if (r.deadline_date < today) {
        daysOverdue = Math.round(
          (new Date(today).getTime() - new Date(r.deadline_date).getTime()) /
            86_400_000,
        );
        bucket = daysOverdue > 7 ? "overdue_severe" : "overdue";
      } else if (r.deadline_date === today) bucket = "today";
      else bucket = "upcoming";
      return {
        id: r.id,
        contact_id: r.contact_id,
        contact_name: name,
        contact_email: r.contact?.email ?? null,
        thread_id: r.thread_id,
        commitment_summary: r.commitment_summary ?? "",
        deadline_date: r.deadline_date,
        deadline_phrase: r.deadline_phrase,
        source_sent_at: r.source_sent_at,
        bucket,
        days_overdue: daysOverdue,
      };
    });
    commitmentsReady = {
      total_open: rows.length,
      overdue_count: rows.filter(
        (r) => r.bucket === "overdue" || r.bucket === "overdue_severe",
      ).length,
      due_today_count: rows.filter((r) => r.bucket === "today").length,
      rows,
    };
  } catch (e) {
    void e; // migration not applied yet
  }

  // Pillar 3 — count drafts the nightly greetings cron has staged
  // for tomorrow. Cheap (one COUNT query, scoped by date).
  let greetingsReady: GreetingsReady = {
    count_for_tomorrow: 0,
    by_kind: {},
    gmail_label_url: "https://mail.google.com/mail/u/0/#label/gy-greetings",
  };
  try {
    // Drafts generated since midnight Athens time will be the ones
    // scheduled for tomorrow (the cron runs at 03:00 Athens).
    const todayStart = new Date(today + "T00:00:00Z").toISOString();
    const { data: drafts } = await sb
      .from("greeting_drafts")
      .select("holiday_kind")
      .gte("generated_at", todayStart)
      .is("sent_at", null);
    const by: Record<string, number> = {};
    for (const d of drafts ?? []) {
      const k = (d.holiday_kind as string) ?? "unknown";
      by[k] = (by[k] ?? 0) + 1;
    }
    greetingsReady = {
      count_for_tomorrow: (drafts ?? []).length,
      by_kind: by,
      gmail_label_url: "https://mail.google.com/mail/u/0/#label/gy-greetings",
    };
  } catch (e) {
    // Migration not applied yet — leave defaults.
    void e;
  }

  return {
    generated_at: new Date().toISOString(),
    greeting: athensGreeting(),
    actions,
    inbox_threads: inbox.threads,
    inbox_summary: inbox.summary,
    pulse,
    opportunities,
    greetings_ready: greetingsReady,
    commitments_ready: commitmentsReady,
    brainstorm_prompt: brainstormPrompt,
    devils_advocate: devilsAdvocate,
    meta: {
      source_contacts: raw.length,
      ranking_method: "heuristic",
    },
  };
}
