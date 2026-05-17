// POST /api/cabins/:id/voyage-bundle — manually trigger the
// post-charter "Voyage Bundle" email (photos + warm note + time
// capsule reveal reminder). Body { only_to?: string } for preview.

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
  if (!secret) {
    return NextResponse.json(
      { error: "CABIN_ADMIN_SECRET not configured on this server" },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => ({}));
  // For previews, default to sending only to the admin so we can
  // sanity-check the email before blasting to every cabin member.
  const onlyTo = body?.only_to ?? (body?.preview ? email : undefined);

  try {
    const r = await fetch(`${publicHost}/api/cabin/admin/voyage-bundle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cabin-admin-secret": secret,
      },
      body: JSON.stringify({ cabin_id: id, only_to: onlyTo }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `status ${r.status}`);
    return NextResponse.json({ ok: true, ...j });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
