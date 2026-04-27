// Sprint 2.2 — nightly per-thread suggested action generator.
//
// Walks the top-N (cap 30) cockpit-eligible threads sorted by
// composite_priority_score, generates an AI one-liner per row,
// caches on contacts.next_touch_suggestion. Re-runs only on rows
// where the suggestion is missing OR older than the contact's
// inbox_analyzed_at (i.e. state changed since last suggestion).

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  suggestAction,
  compositePriorityScore,
} from "@/lib/thread-suggester";

export const runtime = "nodejs";
export const maxDuration = 300;

const TOP_N = 30;

export async function GET() {
  const sb = createServiceClient();

  // Pull contacts that have an inbox state worth suggesting on.
  const { data: rows } = await sb
    .from("contacts")
    .select(
      "id, first_name, last_name, email, charter_fee, inbox_inferred_stage, inbox_gap_days, inbox_last_direction, inbox_last_subject, inbox_last_snippet, inbox_starred, parked_until, declined_at, pipeline_stage:pipeline_stages(name), health_score, next_touch_suggestion, next_touch_suggestion_at, inbox_analyzed_at",
    )
    .not("inbox_inferred_stage", "is", null)
    .neq("inbox_inferred_stage", "unknown")
    .limit(500);

  type Row = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    charter_fee: number | null;
    inbox_inferred_stage: string;
    inbox_gap_days: number | null;
    inbox_last_direction: "inbound" | "outbound" | null;
    inbox_last_subject: string | null;
    inbox_last_snippet: string | null;
    inbox_starred: boolean | null;
    parked_until: string | null;
    declined_at: string | null;
    pipeline_stage: { name: string } | null;
    health_score: number | null;
    next_touch_suggestion: string | null;
    next_touch_suggestion_at: string | null;
    inbox_analyzed_at: string | null;
  };

  // Score everything first, persist composite_priority_score.
  const scored: Array<{ row: Row; score: number }> = [];
  for (const r of (rows ?? []) as unknown as Row[]) {
    // Look up open commitments for this contact (cheap — single
    // query per row, but only N=500 rows so OK).
    const { data: commits } = await sb
      .from("commitments")
      .select("deadline_date, fulfilled_at, dismissed_at")
      .eq("contact_id", r.id)
      .is("fulfilled_at", null)
      .is("dismissed_at", null);
    const today = new Date().toISOString().slice(0, 10);
    const hasOpen = (commits ?? []).length > 0;
    const hasOverdue = (commits ?? []).some(
      (c) => c.deadline_date && (c.deadline_date as string) < today,
    );
    const score = compositePriorityScore({
      inbox_stage: r.inbox_inferred_stage,
      gap_days: r.inbox_gap_days ?? 0,
      starred: !!r.inbox_starred,
      pipeline_stage: r.pipeline_stage?.name ?? null,
      charter_fee: r.charter_fee,
      health_score: r.health_score,
      has_open_commitment: hasOpen,
      has_overdue_commitment: hasOverdue,
      parked_until: r.parked_until,
      declined_at: r.declined_at,
    });
    scored.push({ row: r, score });
    await sb
      .from("contacts")
      .update({ composite_priority_score: score })
      .eq("id", r.id);
  }

  // Top-N by score → generate / refresh suggestion.
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP_N);
  let regenerated = 0;
  let kept = 0;
  for (const { row } of top) {
    const stale =
      !row.next_touch_suggestion_at ||
      (row.inbox_analyzed_at &&
        row.inbox_analyzed_at > row.next_touch_suggestion_at);
    if (!stale && row.next_touch_suggestion) {
      kept++;
      continue;
    }
    const suggestion = await suggestAction({
      contact_name:
        `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() ||
        row.email ||
        "(contact)",
      inbox_stage: row.inbox_inferred_stage,
      gap_days: row.inbox_gap_days ?? 0,
      last_direction: row.inbox_last_direction,
      last_subject: row.inbox_last_subject,
      last_snippet: row.inbox_last_snippet?.slice(0, 280) ?? null,
      pipeline_stage: row.pipeline_stage?.name ?? null,
      charter_fee: row.charter_fee,
      open_commitments: [],
      health_score: row.health_score,
    });
    if (suggestion) {
      await sb
        .from("contacts")
        .update({
          next_touch_suggestion: suggestion,
          next_touch_suggestion_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      regenerated++;
    }
  }

  return NextResponse.json({
    ok: true,
    scored: scored.length,
    top_n: top.length,
    regenerated,
    kept_cached: kept,
  });
}
