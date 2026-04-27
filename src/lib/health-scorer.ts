// Sprint 2.4 — Pillar 5: composite health-score computation.
//
// Per refocus brief §6.2:
//   100
//   - days_since_last_meaningful_exchange × decay_factor
//   + last_message_sentiment_score
//   + reply_rate_last_5_exchanges × engagement_weight
//   + deal_velocity (active deals progressing = boost)
//   - commitment_breach_penalty (open commitments past deadline)
//   + cultural_alignment_bonus (greetings sent and acknowledged)
//
// Returns 0..100 (clamped) plus a per-component breakdown so the
// contact-detail page can render "why this score" tooltips.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WARMTH_SCORE,
  ENGAGEMENT_SCORE,
  INTENT_SCORE,
  type Warmth,
  type Engagement,
  type Intent,
} from "@/lib/sentiment-classifier";

export interface HealthComponents {
  base: number;
  recency: number;             // negative = penalty for staleness
  sentiment: number;           // last meaningful inbound sentiment
  reply_rate: number;          // last-5 inbound/outbound balance
  deal_velocity: number;       // bonus if there's an active deal
  commitment_penalty: number;  // negative if open commitments overdue
  greetings_bonus: number;     // bonus per acknowledged greeting (Pillar 3)
  total: number;
  trend: "up" | "down" | "flat" | null;
}

interface ScorerInput {
  contactId: string;
}

const NOISE_CLASSES = new Set([
  "auto_response",
  "reaction",
  "closing",
  "declined",
  "parked",
]);
const INBOUND_TYPES = new Set([
  "email_inbound",
  "email_received",
  "email_reply_hot_or_warm",
  "email_reply_cold",
  "reply",
]);

export async function computeHealthScore(
  sb: SupabaseClient,
  input: ScorerInput,
): Promise<HealthComponents | null> {
  const { contactId } = input;

  // Pull the activity timeline + latest contact-level data we need.
  const { data: acts } = await sb
    .from("activities")
    .select(
      "type, created_at, message_class, sentiment_warmth, sentiment_engagement, sentiment_intent",
    )
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(50);
  const actsList = acts ?? [];

  // Filter to meaningful messages only (same rule as inbox-analyzer).
  const meaningful = actsList.filter((a) => {
    const cls = a.message_class as string | null;
    if (cls && NOISE_CLASSES.has(cls)) return false;
    const t = a.type as string;
    return INBOUND_TYPES.has(t) || t === "email_sent";
  });

  if (meaningful.length === 0) return null;

  const now = Date.now();
  const lastMeaningful = meaningful[0];
  const lastInbound = meaningful.find((a) =>
    INBOUND_TYPES.has(a.type as string),
  );

  // ─── recency penalty ─────────────────────────────────────────────
  const lastTs = new Date(lastMeaningful.created_at as string).getTime();
  const daysSince = Math.max(0, Math.floor((now - lastTs) / 86_400_000));
  // Decay: 0d = 0 penalty, 7d = -3, 30d = -15, 90d = -45 (capped at 60)
  const recency = -Math.min(60, Math.round(daysSince * 0.5));

  // ─── sentiment of last meaningful inbound ───────────────────────
  let sentiment = 0;
  if (lastInbound) {
    const w = lastInbound.sentiment_warmth as Warmth | null;
    const e = lastInbound.sentiment_engagement as Engagement | null;
    const i = lastInbound.sentiment_intent as Intent | null;
    if (w) sentiment += WARMTH_SCORE[w] ?? 0;
    if (e) sentiment += ENGAGEMENT_SCORE[e] ?? 0;
    if (i) sentiment += INTENT_SCORE[i] ?? 0;
  }

  // ─── reply rate over last 5 exchanges ────────────────────────────
  const last5 = meaningful.slice(0, 5);
  const inb = last5.filter((a) => INBOUND_TYPES.has(a.type as string)).length;
  const out = last5.filter((a) => a.type === "email_sent").length;
  // Healthy back-and-forth = balanced. All inbound (George ghosting) = bad.
  // All outbound (contact ghosting) = bad. 50/50 = best.
  let reply_rate = 0;
  if (last5.length >= 2) {
    const balance = 1 - Math.abs(inb - out) / last5.length; // 1 = perfect
    reply_rate = Math.round(balance * 8); // 0..8 bonus
  }

  // ─── deal velocity ───────────────────────────────────────────────
  const { data: contactRow } = await sb
    .from("contacts")
    .select("charter_fee, charter_start_date, payment_status, pipeline_stage_id")
    .eq("id", contactId)
    .single();
  let deal_velocity = 0;
  if (contactRow?.charter_fee && (contactRow.charter_fee as number) > 0) {
    deal_velocity = 8;
    if (
      contactRow.payment_status === "paid" ||
      contactRow.payment_status === "partial"
    )
      deal_velocity = 12;
  }

  // ─── commitment penalty ──────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const { data: openCommits } = await sb
    .from("commitments")
    .select("deadline_date")
    .eq("contact_id", contactId)
    .is("fulfilled_at", null)
    .is("dismissed_at", null);
  let commitment_penalty = 0;
  for (const c of openCommits ?? []) {
    const dd = c.deadline_date as string | null;
    if (!dd) continue;
    if (dd < today) {
      // -5 per overdue commitment, capped at -25
      commitment_penalty = Math.max(-25, commitment_penalty - 5);
    }
  }

  // ─── greetings bonus ─────────────────────────────────────────────
  // Count greetings that have been sent (sent_at not null) — each is
  // a small relationship-investment marker.
  const { data: greetings } = await sb
    .from("greeting_drafts")
    .select("sent_at")
    .eq("contact_id", contactId)
    .not("sent_at", "is", null);
  const greetings_bonus = Math.min(6, (greetings ?? []).length * 2);

  const base = 70; // start at 70 — neutral-positive default
  const total = Math.max(
    0,
    Math.min(
      100,
      base +
        recency +
        sentiment +
        reply_rate +
        deal_velocity +
        commitment_penalty +
        greetings_bonus,
    ),
  );

  // Trend computed by caller (compare to history). Returned null here.
  return {
    base,
    recency,
    sentiment,
    reply_rate,
    deal_velocity,
    commitment_penalty,
    greetings_bonus,
    total,
    trend: null,
  };
}

/**
 * Persist a fresh score + history snapshot for one contact. The
 * trend (up/down/flat) is computed against the most recent history
 * row (if any from ≥2 days ago).
 */
export async function refreshHealthScore(
  sb: SupabaseClient,
  contactId: string,
): Promise<HealthComponents | null> {
  const components = await computeHealthScore(sb, { contactId });
  if (!components) return null;

  // Trend vs ≥2-day-old history snapshot.
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: hist } = await sb
    .from("health_score_history")
    .select("score, computed_at")
    .eq("contact_id", contactId)
    .lt("computed_at", since)
    .order("computed_at", { ascending: false })
    .limit(1);
  const previous = hist?.[0]?.score as number | undefined;
  let trend: HealthComponents["trend"] = null;
  if (typeof previous === "number") {
    if (components.total > previous + 5) trend = "up";
    else if (components.total < previous - 5) trend = "down";
    else trend = "flat";
  }
  components.trend = trend;

  await sb
    .from("contacts")
    .update({
      health_score: components.total,
      health_score_at: new Date().toISOString(),
      health_score_trend: trend,
      health_components: components,
    })
    .eq("id", contactId);

  // Snapshot today's score (UNIQUE constraint by date prevents dupes).
  await sb
    .from("health_score_history")
    .upsert(
      { contact_id: contactId, score: components.total },
      { onConflict: "contact_id,computed_at" },
    );

  return components;
}
