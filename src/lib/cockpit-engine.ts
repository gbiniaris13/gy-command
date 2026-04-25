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

export interface CockpitBriefing {
  generated_at: string;
  greeting: string;
  actions: CockpitAction[];
  pulse: PipelinePulse;
  opportunities: CockpitOpportunity[];
  brainstorm_prompt: string;
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

// ─── MAIN: BUILD BRIEFING ───────────────────────────────────────────

export async function buildBriefing(sb: SupabaseClient): Promise<CockpitBriefing> {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Pull stages once for FK resolution
  const { data: stages } = await sb.from("pipeline_stages").select("id, name");
  const stageById = new Map<string, string>();
  for (const s of stages ?? []) stageById.set(s.id, s.name);

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

  return {
    generated_at: new Date().toISOString(),
    greeting: athensGreeting(),
    actions,
    pulse,
    opportunities,
    brainstorm_prompt: brainstormPrompt,
    meta: {
      source_contacts: raw.length,
      ranking_method: "heuristic",
    },
  };
}
