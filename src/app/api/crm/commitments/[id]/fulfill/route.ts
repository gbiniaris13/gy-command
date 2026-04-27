// Mark a commitment fulfilled. Used when George explicitly checks
// it off in the cockpit (the cron's auto-fulfillment heuristic
// catches the common case where he's already sent the deliverable).

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = createServiceClient();
  const { error } = await sb
    .from("commitments")
    .update({ fulfilled_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
