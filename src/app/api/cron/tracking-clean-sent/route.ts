// Tracking: George's own Sent copy carries no tracker (see lib/sent-copy.ts).
// Every 2 minutes: each tracked email sent in the last 2 days whose Sent copy
// has not been swapped yet. Fresh ones (under 15 minutes) every run, older
// ones every 10 minutes, so a Helm draft George has not sent yet costs one
// Gmail search per 10 minutes and nothing else.
//
// Manual backfill of older emails: GET ?days=30 with the cron bearer.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { findAndClean, type CleanResult } from "@/lib/sent-copy";
import { observeCron } from "@/lib/cron-observer";

export const runtime = "nodejs";
export const maxDuration = 60;

async function _impl(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const days = Math.min(60, Math.max(2, Number(req.nextUrl.searchParams.get("days")) || 2));
  const backfill = days > 2;
  const now = Date.now();
  const sb = createServiceClient();

  const { data: rows } = await sb
    .from("email_tracking")
    .select("token, recipient, sent_at, source")
    .gte("sent_at", new Date(now - days * 86400_000).toISOString())
    .lte("sent_at", new Date(now - 30_000).toISOString())
    .order("sent_at", { ascending: false })
    .limit(backfill ? 400 : 120);
  const list = rows || [];
  if (!list.length) return NextResponse.json({ ok: true, checked: 0 });

  const { data: settled } = await sb
    .from("email_tracking_hits")
    .select("token")
    .eq("kind", "copy")
    .in("verdict", ["done", "skipped", "gave-up"])
    .in("token", list.map((r) => r.token));
  const doneSet = new Set((settled || []).map((s) => s.token));

  const minute = new Date(now).getUTCMinutes();
  const due = list.filter((r) => {
    if (doneSet.has(r.token)) return false;
    if (backfill) return true;
    const age = now - Date.parse(r.sent_at);
    return age < 15 * 60_000 || minute % 10 === 0;
  });

  const started = Date.now();
  const tally: Record<CleanResult, number> = { done: 0, already: 0, "not-found": 0, failed: 0, skipped: 0 };
  for (const r of due) {
    if (Date.now() - started > 50_000) break;
    tally[await findAndClean(r)]++;
  }
  return NextResponse.json({ ok: true, checked: due.length, ...tally });
}

export async function GET(request: NextRequest): Promise<Response> {
  return observeCron("tracking-clean-sent", () => _impl(request));
}
