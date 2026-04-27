// /api/crm/contacts/export — CSV export of contacts, optionally
// filtered by AI tag (Pillar 2 acceptance criterion: "Resulting list
// is exportable as CSV or directly usable for newsletter send").
//
// Query params:
//   ?tag=travel_advisor          filter to one tag
//   ?stage=Hot                   filter to a CRM stage name
//   ?country=Greece              filter to a country
//   ?replied_within_days=90      only contacts who emailed in last N days

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tag = sp.get("tag");
  const stageName = sp.get("stage");
  const country = sp.get("country");
  const repliedWithinDays = parseInt(sp.get("replied_within_days") ?? "0", 10);

  const sb = createServiceClient();

  // Walk paginated.
  type Row = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    company: string | null;
    country: string | null;
    phone: string | null;
    inbox_inferred_stage: string | null;
    inbox_last_inbound_at: string | null;
    tags_v2: Array<{ tag: string; confidence: number }> | null;
    pipeline_stage: { name: string } | null;
  };
  const rows: Row[] = [];
  const PAGE = 1000;
  let p = 0;
  while (true) {
    const { data, error } = await sb
      .from("contacts")
      .select(
        "id, first_name, last_name, email, company, country, phone, inbox_inferred_stage, inbox_last_inbound_at, tags_v2, pipeline_stage:pipeline_stages(name)",
      )
      .order("created_at", { ascending: true })
      .range(p * PAGE, (p + 1) * PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as unknown as Row[]) rows.push(r);
    if (data.length < PAGE) break;
    p++;
  }

  // Apply filters in JS (faster + simpler than fighting jsonb filters).
  const cutoff =
    repliedWithinDays > 0
      ? Date.now() - repliedWithinDays * 86_400_000
      : null;
  const filtered = rows.filter((r) => {
    if (tag) {
      const has =
        Array.isArray(r.tags_v2) && r.tags_v2.some((t) => t.tag === tag);
      if (!has) return false;
    }
    if (stageName && r.pipeline_stage?.name !== stageName) return false;
    if (country && (r.country ?? "") !== country) return false;
    if (cutoff !== null) {
      const t = r.inbox_last_inbound_at
        ? new Date(r.inbox_last_inbound_at).getTime()
        : 0;
      if (t < cutoff) return false;
    }
    return true;
  });

  const headers = [
    "first_name",
    "last_name",
    "email",
    "company",
    "country",
    "phone",
    "crm_stage",
    "inbox_stage",
    "last_inbound_at",
    "ai_tags",
  ];
  const lines = [headers.join(",")];
  for (const r of filtered) {
    const tags = (r.tags_v2 ?? [])
      .map((t) => `${t.tag}(${t.confidence.toFixed(2)})`)
      .join("|");
    lines.push(
      [
        r.first_name,
        r.last_name,
        r.email,
        r.company,
        r.country,
        r.phone,
        r.pipeline_stage?.name ?? "",
        r.inbox_inferred_stage ?? "",
        r.inbox_last_inbound_at ?? "",
        tags,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const csv = lines.join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gy-contacts-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
