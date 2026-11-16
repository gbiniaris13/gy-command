// GET /api/cron/helm-followup — daily. For each Sent request with a Gmail
// thread: capture any new client reply (→ In Conversation, clear
// follow_up_at). That is ALL it does now.
//
// 2026-11-16 (George: "μία μηχανή, την πατάω εγώ"): the two automatic drafts
// this cron used to write are gone.
//   • The availability "pulse" draft said "I checked this morning … remain
//     available" without anyone having checked. The playbook forbids any
//     availability or urgency claim that is not stored as a dated fact.
//   • The Day-4 / Day-10 template drafts overwrote follow_up_at with now+6d
//     and then null, so they fought the research plan in extraction.pipeline.
// Follow-ups are now written only when George presses Generate on a request
// (src/lib/helm/followup/engine.ts) and sent only when he presses Send. The
// morning brief tells him who is due today.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { captureReplies } from "@/lib/helm/replies";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const { data: rows, error } = await db
    .from("helm_requests")
    .select("id")
    .eq("status", "sent")
    .not("gmail_thread_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let replies = 0;
  for (const r of (rows || []) as { id: string }[]) {
    try {
      const cap = await captureReplies(r.id);
      if (cap.newReplies > 0) replies++;
    } catch (e) {
      console.error("[helm-followup] captureReplies failed", r.id, e);
    }
  }

  return NextResponse.json({ ok: true, scanned: rows?.length || 0, replies, drafts: 0 });
}
