// Inbox Brain analyzer — Pillar 1.
//
// Per-contact thread-state derivation from the activities table.
// Reads every email_* activity for a contact, classifies it as
// inbound or outbound, and emits the derived state used by the
// cockpit ranker.
//
// Design notes:
//   - Single source of truth = activities table. No parallel
//     gmail_threads table to keep in sync.
//   - Inbound types: email_inbound, email_received,
//     email_reply_hot_or_warm, email_reply_cold, reply.
//     Outbound types: email_sent.
//   - "Owed reply" = contact sent last; George hasn't responded yet.
//     Time-agnostic — even a 12h gap is owed.
//   - Stage labels match the brief (Pillar 1, §"Stage inferred from
//     pattern"). They live ALONGSIDE the CRM pipeline_stage — they
//     describe the conversation state, not the commercial state.

import type { SupabaseClient } from "@supabase/supabase-js";

export type InboxStage =
  | "owed_reply"      // contact sent last, George hasn't replied
  | "active"          // back-and-forth in last 14 days
  | "awaiting_reply"  // George sent last, gap 1-7d
  | "needs_followup"  // George sent last, gap 7-30d
  | "cold"            // gap > 30d
  | "new_lead"        // single message, no follow-through
  | "unknown";        // no email activity at all

export interface InboxState {
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_direction: "inbound" | "outbound" | null;
  gap_days: number | null;            // days since the most recent message in either direction
  inferred_stage: InboxStage;
  thread_id: string | null;           // most recent thread
  last_subject: string | null;
  last_snippet: string | null;
  message_count: number;              // total email_* activities seen
  inbound_count: number;
  outbound_count: number;
  analyzed_at: string;
}

const INBOUND_TYPES = new Set([
  "email_inbound",
  "email_received",
  "email_reply_hot_or_warm",
  "email_reply_cold",
  "reply",
]);
const OUTBOUND_TYPES = new Set(["email_sent"]);

interface ActivityRow {
  type: string;
  created_at: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  /** Sprint 2.1: per-message class. The analyzer ignores noise
   *  classes (auto_response / reaction / closing / declined / parked)
   *  when deciding "last meaningful message" — root fix for v2 bugs
   *  1, 2, 3, 4, 5. NULL means not yet classified; we count it as
   *  meaningful (conservative — won't hide real messages). */
  message_class?: string | null;
}

const NOISE_MESSAGE_CLASSES = new Set([
  "auto_response",
  "reaction",
  "closing",
  "declined",
  "parked",
]);

function direction(type: string): "inbound" | "outbound" | null {
  if (INBOUND_TYPES.has(type)) return "inbound";
  if (OUTBOUND_TYPES.has(type)) return "outbound";
  return null;
}

function daysBetween(iso: string, now: number): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 9999;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

export function analyzeActivities(activities: ActivityRow[]): InboxState {
  const now = Date.now();
  let lastInboundAt: string | null = null;
  let lastOutboundAt: string | null = null;
  // Sprint 2.1 — track BOTH the most-recent message (any class) and
  // the most-recent MEANINGFUL message. The analyzer derives stage
  // and snippet from the meaningful one — that fixes the Villy
  // Manolia bug (her real reply 7/4 was being shadowed by an OOO
  // auto-response that arrived 12 hours earlier).
  let mostRecentMeaningful: ActivityRow | null = null;
  let mostRecentMeaningfulDir: "inbound" | "outbound" | null = null;
  let inboundCount = 0;
  let outboundCount = 0;
  let messageCount = 0;
  let lastThreadId: string | null = null;
  let lastSubject: string | null = null;
  let lastSnippet: string | null = null;

  for (const a of activities) {
    const dir = direction(a.type);
    if (!dir) continue;

    // Drop classified noise from BOTH counts and recency tracking.
    // NULL message_class is treated as meaningful (back-compat for
    // not-yet-classified rows + outbound from George which we don't
    // classify).
    const isNoise =
      typeof a.message_class === "string" &&
      NOISE_MESSAGE_CLASSES.has(a.message_class);
    if (isNoise) continue;

    messageCount++;
    if (dir === "inbound") {
      inboundCount++;
      if (!lastInboundAt || a.created_at > lastInboundAt) lastInboundAt = a.created_at;
    } else {
      outboundCount++;
      if (!lastOutboundAt || a.created_at > lastOutboundAt) lastOutboundAt = a.created_at;
    }
    if (!mostRecentMeaningful || a.created_at > mostRecentMeaningful.created_at) {
      mostRecentMeaningful = a;
      mostRecentMeaningfulDir = dir;
      lastThreadId = (a.metadata?.thread_id as string) ?? lastThreadId;
      lastSubject = (a.metadata?.subject as string) ?? lastSubject;
      lastSnippet =
        (a.metadata?.snippet as string) ?? a.description ?? lastSnippet;
    }
  }
  const mostRecent = mostRecentMeaningful;
  const mostRecentDir = mostRecentMeaningfulDir;

  if (messageCount === 0) {
    return {
      last_inbound_at: null,
      last_outbound_at: null,
      last_direction: null,
      gap_days: null,
      inferred_stage: "unknown",
      thread_id: null,
      last_subject: null,
      last_snippet: null,
      message_count: 0,
      inbound_count: 0,
      outbound_count: 0,
      analyzed_at: new Date().toISOString(),
    };
  }

  const gapDays = mostRecent ? daysBetween(mostRecent.created_at, now) : null;

  // Active = at least one in each direction within last 14 days.
  const recentInbound =
    lastInboundAt && daysBetween(lastInboundAt, now) <= 14;
  const recentOutbound =
    lastOutboundAt && daysBetween(lastOutboundAt, now) <= 14;
  const isActive = recentInbound && recentOutbound;

  let stage: InboxStage;
  if (mostRecentDir === "inbound") {
    // Contact sent last. George owes them a reply regardless of duration.
    stage = "owed_reply";
  } else if (mostRecentDir === "outbound") {
    if (gapDays === null) stage = "unknown";
    else if (isActive) stage = "active";
    else if (gapDays > 30) stage = "cold";
    else if (gapDays > 7) stage = "needs_followup";
    else stage = "awaiting_reply";
  } else {
    stage = "unknown";
  }

  // New-lead override: single message, no follow-through, recent.
  if (
    messageCount === 1 &&
    mostRecentDir === "inbound" &&
    gapDays !== null &&
    gapDays <= 30
  ) {
    stage = "owed_reply";
  } else if (
    messageCount === 1 &&
    mostRecentDir === "outbound" &&
    gapDays !== null &&
    gapDays <= 7
  ) {
    stage = "new_lead";
  }

  return {
    last_inbound_at: lastInboundAt,
    last_outbound_at: lastOutboundAt,
    last_direction: mostRecentDir,
    gap_days: gapDays,
    inferred_stage: stage,
    thread_id: lastThreadId,
    last_subject: lastSubject,
    last_snippet: lastSnippet ? lastSnippet.slice(0, 280) : null,
    message_count: messageCount,
    inbound_count: inboundCount,
    outbound_count: outboundCount,
    analyzed_at: new Date().toISOString(),
  };
}

/**
 * Recompute inbox_* fields for a single contact from their activity
 * timeline. Writes back to the contacts row.
 */
export async function refreshContactInbox(
  sb: SupabaseClient,
  contactId: string,
): Promise<InboxState> {
  const { data: rows } = await sb
    .from("activities")
    .select("type, created_at, description, metadata, message_class")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(500);

  const state = analyzeActivities((rows ?? []) as ActivityRow[]);
  await sb
    .from("contacts")
    .update({
      inbox_last_inbound_at: state.last_inbound_at,
      inbox_last_outbound_at: state.last_outbound_at,
      inbox_last_direction: state.last_direction,
      inbox_gap_days: state.gap_days,
      inbox_inferred_stage: state.inferred_stage,
      inbox_thread_id: state.thread_id,
      inbox_last_subject: state.last_subject,
      inbox_last_snippet: state.last_snippet,
      inbox_message_count: state.message_count,
      inbox_analyzed_at: state.analyzed_at,
    })
    .eq("id", contactId);
  return state;
}

/**
 * Recompute inbox_* for every contact. Returns per-stage counts plus
 * a `next_offset` cursor so callers can resume past Vercel's 300s
 * function timeout — at ~200ms per contact, 1605 contacts won't fit
 * in a single invocation.
 *
 * Supabase REST hard-caps any single .select() at 1000 rows by default,
 * so we paginate with .range() inside the offset window.
 *
 * Time-budgeted: stops cleanly at 250s wall clock and returns the
 * next offset to resume from. Pass startOffset=0 on first call,
 * then use the returned next_offset until null.
 */
export async function refreshAllContactsInbox(
  sb: SupabaseClient,
  options: { startOffset?: number; budgetMs?: number } = {},
): Promise<{
  processed: number;
  by_stage: Record<string, number>;
  next_offset: number | null;
  start_offset: number;
}> {
  const startOffset = options.startOffset ?? 0;
  const budgetMs = options.budgetMs ?? 250_000;
  const startedAt = Date.now();
  const PAGE = 500;
  const counts: Record<string, number> = {};
  let processed = 0;
  let cursor = startOffset;

  // Cost guard: only process contacts that have at least one email
  // activity. The "unknown" bucket of 1100+ contacts with zero email
  // history was burning Supabase quota for zero analytical value.
  //
  // CAUTION: Supabase REST hard-caps any single .select() at 1000
  // rows even with .in() + .limit(). The activities table has
  // thousands of email rows, so we MUST paginate this lookup with
  // .range() — otherwise we silently miss contacts whose activities
  // happen to be past row 1000 (typically the older, more important
  // ones).
  const EMAIL_TYPES = [
    "email_sent",
    "email_inbound",
    "email_received",
    "email_reply_hot_or_warm",
    "email_reply_cold",
    "reply",
  ];
  const idSet = new Set<string>();
  let actPage = 0;
  const ACT_PAGE = 1000;
  while (true) {
    const { data: rows, error } = await sb
      .from("activities")
      .select("contact_id")
      .in("type", EMAIL_TYPES)
      .not("contact_id", "is", null)
      .order("created_at", { ascending: false })
      .range(actPage * ACT_PAGE, (actPage + 1) * ACT_PAGE - 1);
    if (error || !rows || rows.length === 0) break;
    for (const r of rows) {
      const id = r.contact_id as string | null;
      if (id) idSet.add(id);
    }
    if (rows.length < ACT_PAGE) break;
    actPage++;
  }
  const uniqueIds = Array.from(idSet).sort();

  while (Date.now() - startedAt < budgetMs) {
    const slice = uniqueIds.slice(cursor, cursor + PAGE);
    if (slice.length === 0) {
      return {
        processed,
        by_stage: counts,
        next_offset: null,
        start_offset: startOffset,
      };
    }
    for (const id of slice) {
      if (Date.now() - startedAt >= budgetMs) {
        return {
          processed,
          by_stage: counts,
          next_offset: cursor,
          start_offset: startOffset,
        };
      }
      try {
        const s = await refreshContactInbox(sb, id);
        counts[s.inferred_stage] = (counts[s.inferred_stage] ?? 0) + 1;
        processed++;
      } catch (err) {
        console.error("[inbox-analyzer] contact failed:", id, err);
      }
      cursor++;
    }
    if (slice.length < PAGE) {
      return {
        processed,
        by_stage: counts,
        next_offset: null,
        start_offset: startOffset,
      };
    }
  }
  return {
    processed,
    by_stage: counts,
    next_offset: cursor,
    start_offset: startOffset,
  };
}
