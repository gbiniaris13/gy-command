// POST /api/cabins/:id/brief — admin saves a brief section.
// Body: { section_key, data }
// Proxies to the public site's secret-protected admin endpoint.

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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const publicHost = process.env.CABIN_PUBLIC_URL || "https://georgeyachts.com";
  const secret = process.env.CABIN_ADMIN_SECRET;
  if (!secret) return NextResponse.json({ error: "CABIN_ADMIN_SECRET not configured" }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body?.section_key) {
    return NextResponse.json({ error: "section_key required" }, { status: 400 });
  }

  const r = await fetch(`${publicHost}/api/cabin/admin/brief`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cabin-admin-secret": secret,
    },
    body: JSON.stringify({
      cabin_id: id,
      section_key: body.section_key,
      data: body.data ?? {},
      actor_email: email,
    }),
  });
  const j = await r.json();
  if (!r.ok) return NextResponse.json({ error: j.error || `status ${r.status}` }, { status: r.status });
  return NextResponse.json(j);
}
