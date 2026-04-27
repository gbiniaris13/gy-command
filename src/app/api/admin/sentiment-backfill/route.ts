// /api/admin/sentiment-backfill — populate activities.sentiment_*
// for all email_inbound activities that don't have it yet.
//
// Time-budgeted with always-from-row-0 pattern (the filter ensures
// updated rows leave the view).

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { classifySentiment } from "@/lib/sentiment-classifier";

export const runtime = "nodejs";
export const maxDuration = 300;

const INBOUND_TYPES = [
  "email_inbound",
  "email_received",
  "email_reply_hot_or_warm",
  "email_reply_cold",
  "reply",
];

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const limit = Math.min(500, Math.max(10, parseInt(sp.get("limit") ?? "200", 10)));
  const sb = createServiceClient();
  const startedAt = Date.now();
  const budgetMs = 250_000;
  let processed = 0;
  const counts: Record<string, number> = {};

  while (Date.now() - startedAt < budgetMs && processed < limit) {
    const { data: rows } = await sb
      .from("activities")
      .select("id, metadata")
      .in("type", INBOUND_TYPES)
      .is("sentiment_warmth", null)
      .order("created_at", { ascending: false })
      .range(0, 49);
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      if (Date.now() - startedAt >= budgetMs || processed >= limit) break;
      const snippet =
        (r.metadata as { snippet?: string } | null)?.snippet ?? "";
      const result = await classifySentiment(snippet);
      if (result) {
        await sb
          .from("activities")
          .update({
            sentiment_warmth: result.warmth,
            sentiment_engagement: result.engagement,
            sentiment_intent: result.intent,
          })
          .eq("id", r.id);
        counts[result.warmth] = (counts[result.warmth] ?? 0) + 1;
      } else {
        // Mark as 'neutral' to skip on next pass if AI failed.
        await sb
          .from("activities")
          .update({
            sentiment_warmth: "neutral",
            sentiment_engagement: "substantive",
            sentiment_intent: "static",
          })
          .eq("id", r.id);
      }
      processed++;
    }
    if (rows.length < 50) break;
  }

  return NextResponse.json({ ok: true, processed, warmth_counts: counts });
}
