// POST /api/hooks/website-inquiry — called by the public site whenever a
// client submits a charter inquiry form, so the request appears in The Helm
// AUTOMATICALLY (George, 2026-07-15: "όταν πελάτης κάνει request από τη
// φόρμα πρέπει να το περνάω χειροκίνητα" - no longer).
//
// Auth: Bearer NEWSLETTER_PROXY_SECRET (the shared site<->CRM secret).
// Behaviour: creates a helm_request in status 'new' via the same
// createRequest used by manual intake (contact upsert included), seeds the
// brief with everything the form knew, and pings George on Telegram with a
// direct link. Double-submit guard: an inquiry from the same email within
// 10 minutes updates nothing and returns the existing id.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { createRequest } from "@/lib/helm-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.NEWSLETTER_PROXY_SECRET;
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim().slice(0, 160);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 320);
  if (!name && !email) {
    return NextResponse.json({ error: "name or email required" }, { status: 400 });
  }

  const phone = String(body.phone ?? "").trim().slice(0, 60);
  const dates = String(body.dates ?? "").trim().slice(0, 200);
  const message = String(body.message ?? "").trim().slice(0, 4000);
  const yachtName = String(body.yachtName ?? "").trim().slice(0, 120);
  const source = String(body.source ?? "website form").trim().slice(0, 80);
  const channel = String(body.preferredChannel ?? "").trim().slice(0, 30);
  // The visitor's trail (2026-10-03): the site collects the last pages the
  // person opened, the yachts they lingered on, minutes on site and the
  // referrer, first-party only. It lands at extraction.visitor so the Helm
  // page can say "they looked at X, Y, Z" before George writes a word.
  const vc = body.visitor_context && typeof body.visitor_context === "object" ? (body.visitor_context as Record<string, unknown>) : null;
  const str = (x: unknown, n = 200) => (typeof x === "string" ? x.trim().slice(0, n) : "");
  const strList = (x: unknown, n = 12) => (Array.isArray(x) ? x.map((v) => str(v, 120)).filter(Boolean).slice(0, n) : []);
  const visitor = vc
    ? {
        pages: Array.isArray(vc.pages)
          ? (vc.pages as unknown[]).map((p) => {
              const o = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
              return { path: str(o.path ?? o.p, 300), title: str(o.title ?? o.t, 160), at: str(o.at, 40) };
            }).filter((p) => p.path).slice(0, 12)
          : [],
        yachts: strList(vc.yachts_this_visit),
        yachts_history: strList(vc.yachts_history),
        minutes: Number.isFinite(Number(vc.session_minutes)) ? Number(vc.session_minutes) : null,
        arrived_from: str(vc.arrived_from, 200),
        captured_at: new Date().toISOString(),
      }
    : null;
  const shortlist = Array.isArray(body.shortlist)
    ? (body.shortlist as { name?: string; weeklyRatePrice?: string }[])
        .map((s) => [s?.name, s?.weeklyRatePrice].filter(Boolean).join(" "))
        .filter(Boolean)
        .slice(0, 12)
    : [];

  // Double-submit guard: same email inside 10 minutes => same request.
  if (email) {
    const sb = createServiceClient();
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recent } = await sb
      .from("helm_requests")
      .select("id")
      .ilike("client_email", email)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (recent) {
      return NextResponse.json({ ok: true, action: "deduped", id: recent.id });
    }
  }

  const brief = [
    `Website inquiry (${source.replace(/_/g, " ")}).`,
    dates ? `Dates: ${dates}` : "",
    yachtName ? `Yacht of interest: ${yachtName}` : "",
    shortlist.length ? `Shortlist: ${shortlist.join("; ")}` : "",
    channel ? `Preferred channel: ${channel}` : "",
    phone ? `Phone/WhatsApp: ${phone}` : "",
    message ? `Message: ${message}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const request = await createRequest({
      client_name: name || undefined,
      client_email: email || undefined,
      client_whatsapp: phone || undefined,
      request_type: "direct_client",
      brief,
      ...(visitor && (visitor.pages.length || visitor.yachts.length) ? { extraction: { visitor } } : {}),
      actorEmail: "website-form",
    });

    try {
      const { sendTelegram } = await import("@/lib/telegram");
      await sendTelegram(
        [
          `🆕 <b>Website request → The Helm</b>`,
          `${name || email}${dates ? ` · ${dates}` : ""}${yachtName ? ` · ${yachtName}` : ""}`,
          `Ανοίχτηκε αυτόματα ως νέο request. Δες το στο Helm dashboard.`,
        ].join("\n"),
      );
    } catch (e) {
      console.error("[website-inquiry] telegram failed", e);
    }

    return NextResponse.json({ ok: true, action: "created", id: request.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
