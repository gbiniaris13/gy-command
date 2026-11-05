// POST /api/t/ext/register — GY Track tells us an email just left Gmail.
// Body: { token, to, subject }. The extension chose the token, signed the
// links and placed the pixel in the browser at the moment of Send; this
// gives the token its row. A repeat (Undo send, then Send again) moves the
// send time forward and keeps the row.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { isExtRequest, isInternalOnly } from "@/lib/email-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  if (!isExtRequest(req.headers.get("x-gy-ext"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { token?: string; to?: string; subject?: string };
  const token = String(body.token || "");
  const to = String(body.to || "").slice(0, 300);
  const subject = String(body.subject || "").slice(0, 500);
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(token) || !to) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (isInternalOnly(to)) return NextResponse.json({ ok: true, skipped: "internal" });

  const sb = createServiceClient();
  const now = new Date().toISOString();
  const { data: existing } = await sb.from("email_tracking").select("id").eq("token", token).maybeSingle();
  if (existing) {
    await sb.from("email_tracking").update({ sent_at: now, recipient: to, subject }).eq("id", existing.id);
  } else {
    const { error } = await sb.from("email_tracking").insert({ token, source: "gmail", recipient: to, subject, sent_at: now });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
