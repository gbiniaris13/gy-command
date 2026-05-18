// POST /api/cabins/:id/send-preference-sheet
//
// Forwards the share request to the public site's admin endpoint
// (which has the KV + Resend + token-minting infrastructure).
// The CRM here just authenticates the operator, picks up
// recipients + message from the dialog, and reports the result.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

async function adminEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const jar = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

type Recipient = { email: string; name?: string };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const recipients = Array.isArray(body?.recipients) ? (body.recipients as Recipient[]) : [];
  const customMessage = String(body?.custom_message ?? "");
  const fromBroker = String(body?.from_broker ?? "").trim() || "George P. Biniaris";

  if (recipients.length === 0) {
    return NextResponse.json({ error: "no-recipients" }, { status: 400 });
  }

  const publicHost = process.env.CABIN_PUBLIC_URL || "https://georgeyachts.com";
  const secret = process.env.CABIN_ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "missing-cabin-admin-secret" },
      { status: 500 },
    );
  }

  const r = await fetch(`${publicHost}/api/cabin/admin/send-preference-share`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cabin-admin-secret": secret,
    },
    body: JSON.stringify({
      cabin_id: id,
      recipients,
      custom_message: customMessage,
      from_broker: fromBroker,
      created_by_email: email,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return NextResponse.json(
      { error: j?.error || `share-failed (${r.status})`, results: j?.results ?? [] },
      { status: r.status },
    );
  }

  return NextResponse.json({
    ok: true,
    share_url: j.share_url,
    sent_count: j.sent_count,
    failed_count: j.failed_count,
    results: j.results,
  });
}
