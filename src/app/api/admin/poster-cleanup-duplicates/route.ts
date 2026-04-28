// Cleanup orphan pending_approval / duplicate scheduled rows.
//
// After the 2026-04-22 approval gate landed, multiple generate-weekly
// runs piled captions into pending_approval that nobody approved. After
// the auto-mode fix (2026-04-28) those rows would silently flood the
// publish queue. This admin keeps the NEWEST scheduled row per
// (post_type, date) and demotes the rest to status='archived' so the
// publish cron skips them but the captions remain auditable.
//
// Idempotent. Safe to re-run.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Row {
  id: string;
  post_type: string | null;
  schedule_time: string;
  status: string;
  created_at: string;
}

export async function GET() {
  const sb = createServiceClient();

  const { data: rows } = await sb
    .from("ig_posts")
    .select("id, post_type, schedule_time, status, created_at")
    .in("status", ["scheduled", "pending_approval"])
    .order("created_at", { ascending: false })
    .limit(2000);

  // Group by (post_type, date(schedule_time))
  const byKey = new Map<string, Row[]>();
  for (const r of (rows ?? []) as Row[]) {
    const date = (r.schedule_time ?? "").slice(0, 10);
    const key = `${r.post_type ?? "image"}__${date}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }

  const keep: string[] = [];
  const archive: string[] = [];

  for (const [, group] of byKey) {
    if (group.length === 1) {
      keep.push(group[0].id);
      continue;
    }
    // Prefer existing 'scheduled' over 'pending_approval'; tie-break newest created_at
    const ranked = [...group].sort((a, b) => {
      const aWeight = a.status === "scheduled" ? 1 : 0;
      const bWeight = b.status === "scheduled" ? 1 : 0;
      if (aWeight !== bWeight) return bWeight - aWeight;
      return b.created_at.localeCompare(a.created_at);
    });
    keep.push(ranked[0].id);
    for (const r of ranked.slice(1)) archive.push(r.id);
  }

  let archived = 0;
  let promoted = 0;

  // Demote duplicates to 'draft' (the original CHECK constraint never
  // allowed 'archived', so we use 'draft' which is universally
  // accepted). The publish cron only picks up 'scheduled' rows, so
  // drafts are effectively shelved without losing the captions.
  for (const id of archive) {
    const { error } = await sb
      .from("ig_posts")
      .update({ status: "draft", error: "duplicate_cleanup" })
      .eq("id", id);
    if (!error) archived += 1;
  }

  // Make sure every survivor that's still pending_approval is promoted
  for (const id of keep) {
    const r = (rows ?? []).find((x) => x.id === id) as Row | undefined;
    if (r?.status === "pending_approval") {
      const { error } = await sb
        .from("ig_posts")
        .update({ status: "scheduled" })
        .eq("id", id);
      if (!error) promoted += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    examined: (rows ?? []).length,
    distinct_groups: byKey.size,
    archived,
    promoted_to_scheduled: promoted,
    kept: keep.length,
  });
}
