// THE LOGBOOK, daily refresh (see src/lib/logbook.ts).
//
// Runs at 05:25 UTC, after the website has closed the day at 05:00 and
// sent George the morning email. It asks the website for the month so
// far (people, not machines), asks Search Console for every day it still
// remembers, and stores both. The page reads only what is stored here.
//
//   ?backfill=1        every month since the first reliable day
//   ?months=2026-09    one or more months, comma separated
//   ?only=visitors     or only=google, or only=clean
//
// The two halves are independent: if the website cannot be reached the
// Google numbers are still refreshed, and the other way round.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { observeCron } from "@/lib/cron-observer";
import { refreshVisitors, refreshGoogle, refreshSeo, syncRequests } from "@/lib/logbook";
import { refreshClean } from "@/lib/logbookClean";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300 since 16/11/2026: the clean numbers read every visit of the month
// (and of the whole history on a backfill) from the tracker.
export const maxDuration = 300;

async function run(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const only = url.searchParams.get("only");
  const months = (url.searchParams.get("months") || "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => /^\d{4}-\d{2}$/.test(m));
  const backfill = url.searchParams.get("backfill") === "1";

  const out: Record<string, unknown> = {};
  let failed = 0;
  if (!only || only === "visitors") {
    try {
      out.visitors = await refreshVisitors({ backfill, months });
    } catch (e) {
      failed += 1;
      out.visitors_error = e instanceof Error ? e.message : "unknown";
      console.error("logbook-refresh: visitors failed:", out.visitors_error);
    }
    // Every stored day against The Helm: a request deleted or marked as
    // spam in an older month stops counting on the next run.
    try {
      out.requests = await syncRequests();
    } catch (e) {
      out.requests_error = e instanceof Error ? e.message : "unknown";
      console.error("logbook-refresh: requests sync failed:", out.requests_error);
    }
  }
  if (!only || only === "google") {
    try {
      out.google = await refreshGoogle();
      // The SEO history (months, movers, the AI side) is built on the
      // days just stored, so it runs after them.
      out.seo = await refreshSeo({ backfill });
    } catch (e) {
      failed += 1;
      out.google_error = e instanceof Error ? e.message : "unknown";
      console.error("logbook-refresh: google failed:", out.google_error);
    }
  }
  // The clean numbers (16/11/2026, src/lib/logbookClean.ts): counted here
  // from the tracker's visits with a copy of the website's rule, and checked
  // against the numbers just stored above. Runs last and on its own: if it
  // fails, everything above is already stored as before.
  if (!only || only === "clean") {
    try {
      out.clean = await refreshClean({ backfill, months });
    } catch (e) {
      out.clean_error = e instanceof Error ? e.message : "unknown";
      console.error("logbook-refresh: clean failed:", out.clean_error);
      if (only === "clean") failed += 1;
    }
  }
  const asked = only ? 1 : 2;
  return NextResponse.json({ ok: failed === 0, ...out }, { status: failed === asked ? 502 : 200 });
}

export async function GET(req: Request): Promise<Response> {
  const denied = await requireUser(req);
  if (denied) return denied;
  return observeCron("logbook-refresh", () => run(req));
}
