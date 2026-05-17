// /api/cabins/[id]/chat — gy-command chat proxy
// GET  ?since=ISO  — fetch (and mark admin-read)
// POST { body }    — admin sends a message

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function publicHost() {
  return process.env.CABIN_PUBLIC_URL || "https://georgeyachts.com";
}

function adminSecret() {
  const s = process.env.CABIN_ADMIN_SECRET;
  if (!s) throw new Error("CABIN_ADMIN_SECRET not configured");
  return s;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await adminEmail();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? "";
  const qs = new URLSearchParams({ cabin_id: id });
  if (since) qs.set("since", since);

  try {
    const r = await fetch(`${publicHost()}/api/cabin/admin/chat?${qs}`, {
      headers: { "x-cabin-admin-secret": adminSecret() },
      cache: "no-store",
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "fetch-failed");
    return NextResponse.json(j);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await adminEmail();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  try {
    const r = await fetch(`${publicHost()}/api/cabin/admin/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cabin-admin-secret": adminSecret(),
      },
      body: JSON.stringify({
        cabin_id: id,
        body: body?.body ?? "",
        actor_email: me,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "send-failed");
    return NextResponse.json(j);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
