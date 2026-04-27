// /api/admin/inbox-tag — runs the Pillar 2 AI tagger over contacts.
//
// Time-budgeted with resumable offset cursor (same pattern as
// inbox-refresh). Skips contacts where tags_overridden = true.
// Default: only contacts that have at least one email_* activity AND
// have not been tagged yet (or were tagged > 30 days ago).
//
// Usage:
//   /api/admin/inbox-tag                          (first chunk)
//   /api/admin/inbox-tag?offset=NNN               (resume)
//   /api/admin/inbox-tag?force=1                  (re-tag everyone)

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { tagOneContact } from "@/lib/pillar2-tagger";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const startOffset = parseInt(sp.get("offset") ?? "0", 10);
  const force = sp.get("force") === "1";
  const budgetMs = 250_000;
  const startedAt = Date.now();

  const sb = createServiceClient();

  // Eligibility: contacts with email activity. Same pagination
  // pattern as inbox-analyzer; the 1000-row Supabase cap bites here
  // too if we don't .range() through it.
  const idSet = new Set<string>();
  let actPage = 0;
  const ACT_PAGE = 1000;
  while (true) {
    const { data: rows } = await sb
      .from("activities")
      .select("contact_id")
      .in("type", [
        "email_sent",
        "email_inbound",
        "email_received",
        "email_reply_hot_or_warm",
        "email_reply_cold",
        "reply",
      ])
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
  let skipped = 0;
  const tagCounts: Record<string, number> = {};

  while (cursor < all.length && Date.now() - startedAt < budgetMs) {
    const id = all[cursor];
    cursor++;

    if (!force) {
      // Skip rows we tagged in the last 30 days.
      const { data: c } = await sb
        .from("contacts")
        .select("tags_overridden, tags_analyzed_at")
        .eq("id", id)
        .single();
      if (c?.tags_overridden) {
        skipped++;
        continue;
      }
      if (c?.tags_analyzed_at) {
        const ageDays =
          (Date.now() - new Date(c.tags_analyzed_at).getTime()) / 86_400_000;
        if (ageDays < 30) {
          skipped++;
          continue;
        }
      }
    }

    const { tags } = await tagOneContact(sb, id);
    if (tags) {
      processed++;
      for (const t of tags) {
        tagCounts[t.tag] = (tagCounts[t.tag] ?? 0) + 1;
      }
    } else {
      skipped++;
    }
  }

  return NextResponse.json({
    ok: true,
    eligible: all.length,
    processed,
    skipped,
    tag_counts: tagCounts,
    next_offset: cursor < all.length ? cursor : null,
    hint:
      cursor < all.length
        ? `Resume with ?offset=${cursor}`
        : "All eligible contacts tagged.",
  });
}
