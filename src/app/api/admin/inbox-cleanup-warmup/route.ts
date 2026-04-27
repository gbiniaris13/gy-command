// /api/admin/inbox-cleanup-warmup — purge warmup-only contacts.
//
// The first backfill rounds (before the warmup-subject guard landed)
// auto-created ~50 contacts whose only activities are cold-email
// warmup pings. They flooded the cockpit's owed_reply pile and
// pushed real benchmark contacts off the top-60.
//
// Targets: contacts whose ONLY activities have a "wbx " token in
// the subject metadata, source=outreach_bot, no notes, no
// charter_fee. Activities cascade-delete.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const apply = sp.get("apply") === "1";
  const sb = createServiceClient();

  // 1. Find candidate contact_ids: source=outreach_bot, no notes, no fee
  const candidateIds: string[] = [];
  let page = 0;
  const PAGE = 1000;
  while (true) {
    const { data: rows, error } = await sb
      .from("contacts")
      .select("id, email")
      .eq("source", "outreach_bot")
      .is("notes", null)
      .or("charter_fee.is.null,charter_fee.eq.0")
      .order("created_at", { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error || !rows || rows.length === 0) break;
    for (const r of rows) candidateIds.push(r.id as string);
    if (rows.length < PAGE) break;
    page++;
  }

  // 2. For each, check if EVERY email_* activity has 'wbx' in
  //    metadata.subject. If yes → warmup-only contact, eligible.
  const warmupOnly: string[] = [];
  for (const id of candidateIds) {
    const { data: acts } = await sb
      .from("activities")
      .select("metadata, type")
      .eq("contact_id", id)
      .in("type", [
        "email_sent",
        "email_inbound",
        "email_received",
        "email_reply_hot_or_warm",
        "email_reply_cold",
        "reply",
      ]);
    if (!acts || acts.length === 0) continue;
    const allWarmup = acts.every((a) => {
      const subj = (a.metadata as { subject?: string } | null)?.subject ?? "";
      return /\bwbx[\s_-]/i.test(subj);
    });
    if (allWarmup) warmupOnly.push(id);
  }

  if (!apply) {
    // Sample
    const sample: Array<{ id: string; email: string | null }> = [];
    if (warmupOnly.length > 0) {
      const { data } = await sb
        .from("contacts")
        .select("id, email")
        .in("id", warmupOnly.slice(0, 10));
      for (const r of data ?? [])
        sample.push({ id: r.id as string, email: r.email as string });
    }
    return NextResponse.json({
      ok: true,
      dry: true,
      candidates_checked: candidateIds.length,
      warmup_only_eligible: warmupOnly.length,
      sample,
      hint: "Add &apply=1 to delete (cascades activities).",
    });
  }

  let deleted = 0;
  const CHUNK = 500;
  for (let i = 0; i < warmupOnly.length; i += CHUNK) {
    const slice = warmupOnly.slice(i, i + CHUNK);
    const { error } = await sb.from("contacts").delete().in("id", slice);
    if (error) {
      return NextResponse.json(
        { error: error.message, deleted_before_error: deleted },
        { status: 500 },
      );
    }
    deleted += slice.length;
  }
  return NextResponse.json({ ok: true, deleted });
}
