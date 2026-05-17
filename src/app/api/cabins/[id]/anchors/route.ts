// POST /api/cabins/:id/anchors — schedule the Memory Anchor sequence.
// Proxies to the public site's admin endpoint (the scheduling logic
// lives in lib/cabin/anchors.js there, alongside the cron sender).

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

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const publicHost = process.env.CABIN_PUBLIC_URL || "https://georgeyachts.com";
  const secret = process.env.CABIN_ADMIN_SECRET;
  if (!secret) return NextResponse.json({ error: "CABIN_ADMIN_SECRET not configured" }, { status: 500 });

  try {
    const r = await fetch(`${publicHost}/api/cabin/admin/schedule-anchors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cabin-admin-secret": secret,
      },
      body: JSON.stringify({ cabin_id: id }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `status ${r.status}`);
    return NextResponse.json({ ok: true, ...j });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
