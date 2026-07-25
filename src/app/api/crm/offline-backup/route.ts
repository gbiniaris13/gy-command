// GET /api/crm/offline-backup — the whole client book as one JSON payload.
//
// George 2026-07-24: "θέλω ένα αρχείο στο Desktop με ΟΛΑ τα στοιχεία των
// πελατών, να τα έχω ακόμα και χωρίς internet, χωρίς CRM". A launchd job on
// his Mac calls this with CRON_SECRET and writes an Excel file to the
// Desktop (see scripts/gy-client-backup.sh in the repo docs). Two sheets:
// every CRM contact, and every Helm charter request with its pipeline state.
//
// Server-only secret auth — same pattern as the cron routes.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { readPipeline } from "@/lib/helm/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const key = req.nextUrl.searchParams.get("key");
  const secret = process.env.CRON_SECRET;
  if (!secret || (auth !== `Bearer ${secret}` && key !== secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = createServiceClient();

  // ── Sheet 1: contacts (paginated walk, same shape as the CSV export) ──
  type ContactRow = {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    company: string | null;
    country: string | null;
    phone: string | null;
    contact_type: string | null;
    source: string | null;
    tags_v2: Array<{ tag: string }> | string[] | null;
    created_at: string | null;
    last_activity_at: string | null;
  };
  const contacts: ContactRow[] = [];
  const PAGE = 1000;
  for (let p = 0; ; p++) {
    const { data, error } = await sb
      .from("contacts")
      .select("first_name, last_name, email, company, country, phone, contact_type, source, tags_v2, created_at, last_activity_at")
      .order("created_at", { ascending: true })
      .range(p * PAGE, (p + 1) * PAGE - 1);
    if (error || !data || data.length === 0) break;
    contacts.push(...(data as unknown as ContactRow[]));
    if (data.length < PAGE) break;
  }

  // ── Sheet 2: Helm requests with pipeline state ────────────────────────
  const { data: helm } = await sb
    .from("helm_requests")
    .select("client_name, client_surname, client_email, client_whatsapp, party_size, budget, area, dates_from, dates_to, status, request_type, created_at, extraction")
    .order("created_at", { ascending: false });

  const helmRows = (helm ?? []).map((r) => {
    const p = readPipeline((r as { extraction?: unknown }).extraction);
    return {
      name: [r.client_name, r.client_surname].filter(Boolean).join(" "),
      email: r.client_email,
      whatsapp: r.client_whatsapp,
      type: r.request_type === "travel_agent" ? "travel advisor" : "direct client",
      guests: r.party_size,
      budget: r.budget,
      route: r.area,
      dates: [r.dates_from, r.dates_to].filter(Boolean).join(" to "),
      status: r.status,
      received: r.created_at,
      proposal_sent: p.sent_at ?? "",
      notes: p.notes ?? "",
    };
  });

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    contacts: contacts.map((c) => ({
      name: [c.first_name, c.last_name].filter(Boolean).join(" "),
      email: c.email,
      phone: c.phone,
      company: c.company,
      country: c.country,
      type: c.contact_type,
      source: c.source,
      tags: Array.isArray(c.tags_v2)
        ? c.tags_v2.map((t) => (typeof t === "string" ? t : t?.tag)).filter(Boolean).join(", ")
        : "",
      created: c.created_at,
      last_activity: c.last_activity_at,
    })),
    helm: helmRows,
  });
}
