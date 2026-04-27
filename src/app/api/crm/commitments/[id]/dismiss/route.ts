// Mark a commitment dismissed (no longer relevant). Used when the
// situation changed and the commitment is moot.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reason = request.nextUrl.searchParams.get("reason") ?? null;
  const sb = createServiceClient();
  const { error } = await sb
    .from("commitments")
    .update({
      dismissed_at: new Date().toISOString(),
      dismiss_reason: reason,
    })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
