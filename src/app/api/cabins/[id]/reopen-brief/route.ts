// gy-command — POST /api/cabins/:id/reopen-brief
//
// 2026-05-22 — Concierge-mode "Reopen the brief" action. After
// the principal charterer presses "Send to George" on the
// cabin's brief review screen, the brief is locked: every
// /api/cabin/brief/:section PUT on the public site rejects with
// 423 LOCKED while the cabin row carries brief_submitted_at.
//
// This endpoint clears that timestamp + the submitted_by member
// id, unlocking the brief for everyone. The audit row records
// who reopened it (the operator's Supabase email) so the cabin's
// audit log shows the round-trip.
//
// Authed via the operator's Supabase session — anyone signed in
// to GY Command can reopen any cabin they can see. There is no
// per-cabin role concept on the CRM side; the operator is
// trusted.
//
// Returns a 303 redirect back to the cabin detail page so the
// "Reopen" form button can fire and refresh in one go.

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

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const me = await adminEmail();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const publicHost =
    process.env.CABIN_PUBLIC_URL || "https://georgeyachts.com";
  const secret = process.env.CABIN_ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CABIN_ADMIN_SECRET not configured" },
      { status: 500 },
    );
  }

  const r = await fetch(`${publicHost}/api/cabin/admin/reopen-brief`, {
    method: "POST",
    headers: {
      "x-cabin-admin-secret": secret,
      "content-type": "application/json",
    },
    body: JSON.stringify({ cabin_id: id, actor_email: me }),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return NextResponse.json(
      { error: text || `upstream ${r.status}` },
      { status: r.status },
    );
  }

  // Redirect back to the cabin detail page so the form action
  // refreshes the badge in one round-trip.
  const origin = new URL(req.url).origin;
  return NextResponse.redirect(`${origin}/dashboard/cabins/${id}`, 303);
}
