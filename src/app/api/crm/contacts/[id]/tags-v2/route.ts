// /api/crm/contacts/:id/tags-v2 — manual override of Pillar 2 AI tags.
//
// PUT body: { tags: ["travel_advisor", "b2b_partner", ...] }
// Sets contacts.tags_v2 to the given list (with confidence=1.0,
// source='manual') AND tags_overridden=true so the AI tagger never
// reverts the choice.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "travel_advisor",
  "charter_client",
  "b2b_partner",
  "press",
  "vendor",
  "cold_lead",
]);

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { tags?: string[] };
  const cleaned = (body.tags ?? [])
    .filter((t) => ALLOWED.has(t))
    .map((tag) => ({ tag, confidence: 1, source: "manual" as const }));

  const sb = createServiceClient();
  const { error } = await sb
    .from("contacts")
    .update({
      tags_v2: cleaned,
      tags_overridden: true,
      tags_analyzed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, tags: cleaned });
}
