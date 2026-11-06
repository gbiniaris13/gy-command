// GET /api/hooks/logbook-requests?since=ISO&until=ISO
//
// The requests The Helm received in a span, for the website's morning
// email. The email used to count requests from the notes two of the
// site's forms leave in the site's own database, which missed most of
// them (see src/lib/logbook.ts). The Logbook page and the email now read
// the same list from the same place, so they agree.
//
// Auth: Bearer NEWSLETTER_PROXY_SECRET (the shared site<->CRM secret) or
// the cron secret. Read only. Returns names because the reader is
// George's own inbox: [{ created_at, title, description }], the shape the
// email's builder already takes.

import { NextRequest, NextResponse } from "next/server";
import { helmRequestsBetween } from "@/lib/logbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SPAN_MS = 45 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const allowed = [process.env.NEWSLETTER_PROXY_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!provided || !allowed.includes(provided)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const since = Date.parse(req.nextUrl.searchParams.get("since") || "");
  const until = Date.parse(req.nextUrl.searchParams.get("until") || "");
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since || until - since > MAX_SPAN_MS) {
    return NextResponse.json({ error: "since and until must be dates, at most 45 days apart" }, { status: 400 });
  }
  try {
    const rows = await helmRequestsBetween(new Date(since).toISOString(), new Date(until).toISOString());
    return NextResponse.json(
      { ok: true, requests: rows.map((r) => ({ created_at: new Date(r.at).toISOString(), title: r.label, description: "The Helm" })) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("logbook-requests:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 502 });
  }
}
