// POST /api/t/ext/seen — George's own Gmail has an email carrying one of
// our pixels on screen right now. Body: { tokens: string[] }.
//
// GY Track reads the pixel address out of the images Gmail is showing him
// (Gmail's proxy keeps the original after a "#"). Every human open within
// the last two minutes on those tokens is his, so it is relabelled `self`
// and taken off the count, and the mark makes the pixel route file any open
// in the next two minutes the same way (see seenRecently). The open route
// waits a few seconds before counting, so whichever arrives first, his own
// reading never reaches him as an alert.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { isExtRequest, recordMeta, SEEN_WINDOW_MS } from "@/lib/email-tracking";

import { ipFrom, noteHouseIp } from "@/lib/house-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  if (!isExtRequest(req.headers.get("x-gy-ext"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await noteHouseIp(ipFrom(req.headers), req.headers.get("user-agent"));
  const body = (await req.json().catch(() => ({}))) as { tokens?: unknown };
  const tokens = (Array.isArray(body.tokens) ? body.tokens : [])
    .map(String)
    .filter((t) => /^[A-Za-z0-9_-]{6,40}$/.test(t))
    .slice(0, 30);
  if (!tokens.length) return NextResponse.json({ ok: true, tokens: 0 });

  const sb = createServiceClient();
  const since = new Date(Date.now() - SEEN_WINDOW_MS).toISOString();
  const { data: rows } = await sb
    .from("email_tracking")
    .select("id, token, open_count, first_open_at")
    .in("token", tokens);
  let relabelled = 0;
  for (const row of rows || []) {
    await recordMeta(row.token, "seen", "self", {});
    const { data: hits } = await sb
      .from("email_tracking_hits")
      .select("id, at")
      .eq("token", row.token)
      .eq("kind", "open")
      .eq("verdict", "human")
      .gte("at", since);
    if (!hits || !hits.length) continue;
    await sb.from("email_tracking_hits").update({ verdict: "self" }).in("id", hits.map((h) => h.id));
    relabelled += hits.length;
    // Counters move only after the open route's short wait, so take off at
    // most what was already counted.
    const counted = hits.filter((h) => Date.now() - Date.parse(h.at) > 6_000).length;
    const firstWasHis =
      !!row.first_open_at && hits.some((h) => Math.abs(Date.parse(h.at) - Date.parse(row.first_open_at)) < 10_000);
    if (counted || firstWasHis) {
      await sb
        .from("email_tracking")
        .update({
          open_count: Math.max(0, (row.open_count || 0) - counted),
          ...(firstWasHis ? { first_open_at: null, open_notified: false } : {}),
        })
        .eq("id", row.id);
    }
  }
  return NextResponse.json({ ok: true, tokens: tokens.length, relabelled });
}
