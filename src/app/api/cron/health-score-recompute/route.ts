// Pillar 5 — nightly health-score recompute.
//
// Walks all contacts that have at least one email activity
// (eligibility set the same as inbox-tag), refreshes their
// health_score + history snapshot. Time-budgeted with resumable
// offset cursor.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { refreshHealthScore } from "@/lib/health-scorer";

export const runtime = "nodejs";
export const maxDuration = 300;

const EMAIL_TYPES = [
  "email_sent",
  "email_inbound",
  "email_received",
  "email_reply_hot_or_warm",
  "email_reply_cold",
  "reply",
];

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const startOffset = parseInt(sp.get("offset") ?? "0", 10);
  const startedAt = Date.now();
  const budgetMs = 250_000;
  const sb = createServiceClient();

  // Eligible contact ids — same paginated walk as inbox-tag.
  const idSet = new Set<string>();
  let actPage = 0;
  const ACT_PAGE = 1000;
  while (true) {
    const { data: rows } = await sb
      .from("activities")
      .select("contact_id")
      .in("type", EMAIL_TYPES)
      .not("contact_id", "is", null)
      .order("created_at", { ascending: false })
      .range(actPage * ACT_PAGE, (actPage + 1) * ACT_PAGE - 1);
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      const id = r.contact_id as string | null;
      if (id) idSet.add(id);
    }
    if (rows.length < ACT_PAGE) break;
    actPage++;
  }
  const all = Array.from(idSet).sort();

  let cursor = startOffset;
  let processed = 0;
  const buckets = { red: 0, orange: 0, green: 0 };
  while (cursor < all.length && Date.now() - startedAt < budgetMs) {
    const id = all[cursor];
    cursor++;
    try {
      const c = await refreshHealthScore(sb, id);
      if (c) {
        if (c.total < 40) buckets.red++;
        else if (c.total < 70) buckets.orange++;
        else buckets.green++;
        processed++;
      }
    } catch (err) {
      console.error("[health-score] failed for", id, err);
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    eligible: all.length,
    buckets,
    next_offset: cursor < all.length ? cursor : null,
    hint:
      cursor < all.length
        ? `Resume with ?offset=${cursor}`
        : "All contacts scored.",
  });
}
