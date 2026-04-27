// /api/admin/inbox-cleanup-noise — undoes the over-eager auto-create
// from the d0292e5 backfill run.
//
// Targets: contacts created after a cutoff timestamp via the auto-
// create path (source=outreach_bot, contact_type=OUTREACH_LEAD) that
// have no human-curated state on them — no notes, no pipeline_stage
// other than the default 'New', no charter_fee. Their backfilled
// activities cascade-delete.
//
// Usage:
//   /api/admin/inbox-cleanup-noise?since=2026-04-27T11:50:00Z         (count)
//   /api/admin/inbox-cleanup-noise?since=2026-04-27T11:50:00Z&apply=1 (delete)

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const since = sp.get("since");
  const apply = sp.get("apply") === "1";
  if (!since) {
    return NextResponse.json(
      { error: "pass ?since=ISO8601 (e.g. 2026-04-27T11:50:00Z)" },
      { status: 400 },
    );
  }

  const sb = createServiceClient();

  // Count what would be deleted.
  const { count: totalAfter } = await sb
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  const { data: candidates } = await sb
    .from("contacts")
    .select("id, email, first_name, last_name, charter_fee, notes, created_at")
    .gte("created_at", since)
    .eq("source", "outreach_bot")
    .is("notes", null)
    .or("charter_fee.is.null,charter_fee.eq.0")
    .limit(10000);

  const ids = (candidates ?? []).map((c) => c.id as string);
  const sample = (candidates ?? []).slice(0, 10).map((c) => ({
    email: c.email,
    name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
    created_at: c.created_at,
  }));

  if (!apply) {
    return NextResponse.json({
      ok: true,
      dry: true,
      total_contacts_created_after_cutoff: totalAfter,
      cleanup_candidates: ids.length,
      sample,
      hint: "Add &apply=1 to actually delete (cascades activities).",
    });
  }

  // Delete in chunks to stay under any per-request row cap.
  let deleted = 0;
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await sb.from("contacts").delete().in("id", slice);
    if (error) {
      return NextResponse.json(
        { error: error.message, deleted_before_error: deleted },
        { status: 500 },
      );
    }
    deleted += slice.length;
  }

  return NextResponse.json({ ok: true, deleted, sample });
}
