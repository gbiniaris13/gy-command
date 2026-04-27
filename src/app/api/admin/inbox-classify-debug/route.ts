// /api/admin/inbox-classify-debug?email=X
// Returns each activity for the contact + its message_class so we can
// see WHY the analyzer's "last meaningful message" picked what it did.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get("email");
  if (!email) {
    return NextResponse.json({ error: "pass ?email=..." }, { status: 400 });
  }
  const sb = createServiceClient();
  const { data: c } = await sb
    .from("contacts")
    .select("id, first_name, last_name, email, inbox_inferred_stage, inbox_gap_days, inbox_message_count")
    .ilike("email", email)
    .single();
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: acts } = await sb
    .from("activities")
    .select("id, type, created_at, message_class, message_class_confidence, message_class_reason, metadata")
    .eq("contact_id", c.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    contact: c,
    activities: (acts ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      created_at: a.created_at,
      message_class: a.message_class,
      confidence: a.message_class_confidence,
      reason: a.message_class_reason,
      from: (a.metadata as { from?: string } | null)?.from ?? null,
      subject:
        (a.metadata as { subject?: string } | null)?.subject ?? null,
      snippet:
        (a.metadata as { snippet?: string } | null)?.snippet?.slice(0, 160) ??
        null,
    })),
  });
}
