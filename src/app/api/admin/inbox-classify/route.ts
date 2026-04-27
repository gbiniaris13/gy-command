// /api/admin/inbox-classify — classifies all email_inbound activities
// that haven't been classified yet, plus updates contact lifecycle
// fields (parked_until, declined_at, lifecycle_state).
//
// Heuristics-only by default to keep cost down on the bulk pass.
// Pass ?ai=1 to let unclassified-by-heuristic rows fall through to
// the AI verifier. Time-budgeted with resumable cursor.
//
// Run pattern:
//   /api/admin/inbox-classify              first chunk (heuristics only)
//   /api/admin/inbox-classify?offset=NNN   resume
//   /api/admin/inbox-classify?ai=1         heuristics + AI fallback
//
// Idempotent: skips rows that already have message_class set unless
// ?force=1 is passed.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { classifyMessage, type MessageClass } from "@/lib/message-classifier";

export const runtime = "nodejs";
export const maxDuration = 300;

const INBOUND_TYPES = [
  "email_inbound",
  "email_received",
  "email_reply_hot_or_warm",
  "email_reply_cold",
  "reply",
];

const SELF_EMAIL = "george@georgeyachts.com";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const startOffset = parseInt(sp.get("offset") ?? "0", 10);
  const useAi = sp.get("ai") === "1";
  const force = sp.get("force") === "1";
  const budgetMs = 250_000;
  const startedAt = Date.now();

  const sb = createServiceClient();

  // Pull candidate activity IDs. The default mode (no ?force) filters
  // for message_class IS NULL — so after each update those rows leave
  // the view and we ALWAYS query from offset 0 (the next unclassified
  // batch). With ?force the cursor advances normally because the view
  // is stable.
  const PAGE = 500;
  let cursor = startOffset;
  let processed = 0;
  let updated = 0;
  const counts: Record<string, number> = {};
  const lifecycleUpdates = new Map<
    string,
    { parked_until?: string; declined_at?: string; declined_reason?: string }
  >();

  while (Date.now() - startedAt < budgetMs) {
    // When filtering, always read from row 0 — updated rows fall out
    // of the view, so the next batch of unclassified is at the top.
    const from = force ? cursor : 0;
    const to = from + PAGE - 1;
    let query = sb
      .from("activities")
      .select("id, contact_id, created_at, description, metadata")
      .in("type", INBOUND_TYPES)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (!force) query = query.is("message_class", null);
    const { data: rows, error } = await query;
    if (error || !rows || rows.length === 0) {
      // No more rows — done.
      break;
    }
    for (const r of rows) {
      if (Date.now() - startedAt >= budgetMs) {
        return NextResponse.json({
          ok: true,
          processed,
          updated,
          counts,
          next_offset: cursor,
          hint: `Resume with ?offset=${cursor}`,
        });
      }
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const subject = (meta.subject as string) ?? "";
      const snippet = (meta.snippet as string) ?? r.description ?? "";
      const fromHeader = (meta.from as string) ?? "";

      const cls = await classifyMessage(
        {
          from: fromHeader,
          self_email: SELF_EMAIL,
          subject,
          body: snippet,
          headers: {},
        },
        { useAi },
      );

      counts[cls.message_class] = (counts[cls.message_class] ?? 0) + 1;

      await sb
        .from("activities")
        .update({
          message_class: cls.message_class,
          message_class_confidence: cls.confidence,
          message_class_reason: cls.reason,
        })
        .eq("id", r.id);
      updated++;
      processed++;

      // Lifecycle side-effects on the contact.
      if (
        r.contact_id &&
        (cls.message_class === "parked" || cls.message_class === "declined")
      ) {
        const cid = r.contact_id as string;
        const cur = lifecycleUpdates.get(cid) ?? {};
        if (cls.message_class === "parked" && cls.parked_until) {
          cur.parked_until = cls.parked_until;
        }
        if (cls.message_class === "declined") {
          cur.declined_at = r.created_at as string;
          if (cls.decline_reason) cur.declined_reason = cls.decline_reason;
        }
        lifecycleUpdates.set(cid, cur);
      }
      cursor++;
    }
    if (rows.length < PAGE) break;
  }

  // Apply lifecycle updates in bulk per contact.
  for (const [cid, upd] of lifecycleUpdates.entries()) {
    const patch: Record<string, unknown> = {};
    if (upd.parked_until) {
      patch.parked_until = upd.parked_until;
      patch.lifecycle_state = "parked";
    }
    if (upd.declined_at) {
      patch.declined_at = upd.declined_at;
      patch.lifecycle_state = "declined";
      if (upd.declined_reason) patch.declined_reason = upd.declined_reason;
    }
    if (Object.keys(patch).length > 0) {
      await sb.from("contacts").update(patch).eq("id", cid);
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    updated,
    counts: counts as Record<MessageClass, number>,
    lifecycle_updates: lifecycleUpdates.size,
    next_offset: null,
    hint: "All eligible activities classified.",
  });
}
