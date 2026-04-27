// /api/admin/inbox-cleanup-warmup — purge warmup-only contacts.
//
// Deletes contacts whose ONLY email_* activities are cold-email warmup
// pings (subject contains a 'wbx XXX' / 'wbx-XXX' / 'wbx_XXX' token).
// Cascades activities.
//
// Implementation: one paginated bulk fetch of email activities,
// grouped per contact_id in memory, classified as
// warmup-only / mixed / clean. No per-contact queries.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 120;

const EMAIL_TYPES = [
  "email_sent",
  "email_inbound",
  "email_received",
  "email_reply_hot_or_warm",
  "email_reply_cold",
  "reply",
];

const WARMUP_RE = /\bwbx[\s_-]/i;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const apply = sp.get("apply") === "1";
  const sb = createServiceClient();

  // 1. Pull all email activities, paginated. We need both a "looks
  //    like warmup?" classification AND a "do they have any non-
  //    warmup email?" check per contact.
  const counts = new Map<string, { total: number; warmup: number }>();
  let actPage = 0;
  const ACT_PAGE = 1000;
  while (true) {
    const { data: rows, error } = await sb
      .from("activities")
      .select("contact_id, metadata")
      .in("type", EMAIL_TYPES)
      .not("contact_id", "is", null)
      .order("created_at", { ascending: false })
      .range(actPage * ACT_PAGE, (actPage + 1) * ACT_PAGE - 1);
    if (error || !rows || rows.length === 0) break;
    for (const r of rows) {
      const cid = r.contact_id as string;
      const subj = (r.metadata as { subject?: string } | null)?.subject ?? "";
      const isWarmup = WARMUP_RE.test(subj);
      const cur = counts.get(cid) ?? { total: 0, warmup: 0 };
      cur.total++;
      if (isWarmup) cur.warmup++;
      counts.set(cid, cur);
    }
    if (rows.length < ACT_PAGE) break;
    actPage++;
  }

  // 2. Eligible: total>0 AND warmup === total (every activity is warmup).
  const warmupOnly: string[] = [];
  for (const [cid, c] of counts.entries()) {
    if (c.total > 0 && c.warmup === c.total) warmupOnly.push(cid);
  }

  // 3. Restrict to safe-to-delete contacts (source=outreach_bot, no
  //    notes, no charter_fee). Walk paginated.
  const safeToDelete: string[] = [];
  if (warmupOnly.length > 0) {
    for (let i = 0; i < warmupOnly.length; i += 200) {
      const slice = warmupOnly.slice(i, i + 200);
      const { data: rows } = await sb
        .from("contacts")
        .select("id, email")
        .in("id", slice)
        .eq("source", "outreach_bot")
        .is("notes", null)
        .or("charter_fee.is.null,charter_fee.eq.0");
      for (const r of rows ?? []) safeToDelete.push(r.id as string);
    }
  }

  if (!apply) {
    return NextResponse.json({
      ok: true,
      dry: true,
      total_emailed_contacts: counts.size,
      warmup_only_classified: warmupOnly.length,
      safe_to_delete: safeToDelete.length,
      hint: "Add &apply=1 to delete (cascades activities).",
    });
  }

  let deleted = 0;
  const CHUNK = 500;
  for (let i = 0; i < safeToDelete.length; i += CHUNK) {
    const slice = safeToDelete.slice(i, i + CHUNK);
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
