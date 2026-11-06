// THE LOGBOOK, daily refresh (see src/lib/logbook.ts).
//
// Runs at 05:25 UTC, after the website has closed the day at 05:00 and
// sent George the morning email. It asks the website for the month so
// far (people, not machines), asks Search Console for every day it still
// remembers, and stores both. The page reads only what is stored here.
//
//   ?backfill=1        every month since the first reliable day
//   ?months=2026-09    one or more months, comma separated
//   ?only=visitors     or only=google
//
// The two halves are independent: if the website cannot be reached the
// Google numbers are still refreshed, and the other way round.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { observeCron } from "@/lib/cron-observer";
import { refreshVisitors, refreshGoogle } from "@/lib/logbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  if (only !== "google") {
    try {
      out.visitors = await refreshVisitors({ backfill, months });
    } catch (e) {
      failed += 1;
      out.visitors_error = e instanceof Error ? e.message : "unknown";
      console.error("logbook-refresh: visitors failed:", out.visitors_error);
    }
  }
  if (only !== "visitors") {
    try {
      out.google = await refreshGoogle();
    } catch (e) {
      failed += 1;
      out.google_error = e instanceof Error ? e.message : "unknown";
      console.error("logbook-refresh: google failed:", out.google_error);
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
