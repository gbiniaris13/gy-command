// GET /api/hooks/helm-read?since=ISO&until=ISO
//
// What the requests in The Helm were about in a span, for the article
// engine: the occasion, the party, the dates, the area, the budget, what
// was asked for and why a charter was won or lost. It answers "what do
// people actually ask us", never "who asked".
//
// Read only. Nothing here writes to The Helm.
//
// No client identity leaves this route. No name, surname, title, email,
// WhatsApp, contact id, Gmail id, email subject or intro, supplier text,
// agency email or yacht name is returned. The name and email are read
// for one purpose only, to drop test rows, George's own rows and sales
// pitches with the same rule The Logbook uses (notARequest), and to
// strike the client's own name out of the free text. The free text
// (brief, special requests, won and lost reasons) has every email
// address and phone number replaced and is cut to 1,500 characters. The
// id is cut to its first 8 characters.
//
// NEVER proposal_json, and never "*": that column is 20MB and more per
// row and reading it has taken the database down before. The columns are
// named one by one below.
//
// Auth: Bearer CRON_SECRET, nothing else.

import { NextRequest, NextResponse } from "next/server";
import { notARequest } from "@/lib/logbook";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SPAN_MS = 400 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 1000;
const MAX_TEXT = 1500;

// The columns that go out, plus the three read only to exclude and scrub.
const OUT_COLUMNS =
  "id, created_at, status, occasion, party_size, dates_from, dates_to, area, mode, request_type, budget, brief, special_requests, won_reason, lost_reason, last_activity_at";
const SCRUB_ONLY_COLUMNS = "client_name, client_surname, client_email";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Eight digits or more, with spaces, +, - and parentheses between them.
const PHONE = /\+?\(?\d(?:[\s\-()]*\d){7,}\)?/g;
const ISO_DATES_ONLY = /^(?:\d{4}-\d{2}-\d{2}[\s\-()]*)+$/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The client's own name, word by word (3 letters and up), as it may
// appear inside the brief ("Mr Smith would like...").
function nameRe(...parts: unknown[]): RegExp | null {
  const words = parts
    .flatMap((p) => String(p || "").split(/[^\p{L}]+/u))
    .filter((w) => w.length >= 3)
    .map(escapeRe);
  if (!words.length) return null;
  return new RegExp(`(?<![\\p{L}])(?:${[...new Set(words)].join("|")})(?![\\p{L}])`, "giu");
}

function scrub(value: unknown, name: RegExp | null): string | null {
  if (value == null) return null;
  let text = String(value)
    .replace(EMAIL, "<email>")
    // A run made only of written dates (2027-07-12) is not a phone.
    .replace(PHONE, (m) => (ISO_DATES_ONLY.test(m) ? m : "<phone>"));
  if (name) text = text.replace(name, "<name>");
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

export async function GET(req: NextRequest) {
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const since = Date.parse(req.nextUrl.searchParams.get("since") || "");
  const until = Date.parse(req.nextUrl.searchParams.get("until") || "");
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since || until - since > MAX_SPAN_MS) {
    return NextResponse.json({ error: "since and until must be dates, at most 400 days apart" }, { status: 400 });
  }
  try {
    const sb = createServiceClient();
    const { data, error } = await sb
      .from("helm_requests")
      .select(`${OUT_COLUMNS}, ${SCRUB_ONLY_COLUMNS}`)
      .gte("created_at", new Date(since).toISOString())
      .lt("created_at", new Date(until).toISOString())
      .order("created_at", { ascending: true })
      // Rows with the same time (imported together) keep one fixed order.
      .order("id", { ascending: true })
      .limit(MAX_ROWS);
    if (error) throw new Error(`helm_requests read failed: ${error.message}`);
    const requests = [];
    for (const r of (data || []) as unknown as Record<string, unknown>[]) {
      // Test rows, George's own rows, sales pitches, rows marked spam.
      if (notARequest(r)) continue;
      const name = nameRe(r.client_name, r.client_surname);
      requests.push({
        id: String(r.id).slice(0, 8),
        created_at: r.created_at,
        status: r.status,
        occasion: r.occasion,
        party_size: r.party_size,
        dates_from: r.dates_from,
        dates_to: r.dates_to,
        area: r.area,
        mode: r.mode,
        request_type: r.request_type,
        budget: r.budget,
        brief: scrub(r.brief, name),
        special_requests: scrub(r.special_requests, name),
        won_reason: scrub(r.won_reason, name),
        lost_reason: scrub(r.lost_reason, name),
        last_activity_at: r.last_activity_at,
      });
    }
    return NextResponse.json(
      { ok: true, count: requests.length, requests },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("helm-read:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 502 });
  }
}
