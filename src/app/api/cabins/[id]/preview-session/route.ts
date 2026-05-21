// gy-command — proxy: ask the public site to mint a short-lived
// admin preview session for this cabin, return the landing URL
// the CRM button should open in a new tab.
//
// George's brief (2026-05-21): "View as guest / Preview as
// customer" is a separate step from sending the magic link.
// Different colour in the action bar so the operator can read
// the workflow as: (1) preview to verify, (2) send invite to
// the actual customer. This proxy hides CABIN_ADMIN_SECRET on
// the server side — the browser never sees it.

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
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const me = await adminEmail();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const publicHost = process.env.CABIN_PUBLIC_URL || "https://georgeyachts.com";
  const secret = process.env.CABIN_ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CABIN_ADMIN_SECRET not configured on this deployment" },
      { status: 500 },
    );
  }

  const r = await fetch(`${publicHost}/api/cabin/admin/start-preview`, {
    method: "POST",
    headers: {
      "x-cabin-admin-secret": secret,
      "content-type": "application/json",
    },
    body: JSON.stringify({ cabin_id: id, admin_email: me }),
  });
  const json = await r.json().catch(() => ({ error: "upstream-bad-json" }));
  return NextResponse.json(json, { status: r.ok ? 200 : r.status });
}
