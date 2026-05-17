// POST /api/cabins — create a new Cabin from the admin form.

import { NextResponse } from "next/server";
import { createCabin } from "@/lib/cabin-admin";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

async function adminEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const jar = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return jar.getAll(); },
      setAll() {},
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function POST(req: Request) {
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.vessel_name || !body?.principal_charterer_email) {
    return NextResponse.json({ error: "vessel_name + principal_charterer_email required" }, { status: 400 });
  }

  try {
    const cabin = await createCabin({ ...body, actorEmail: email });
    return NextResponse.json({ ok: true, id: cabin.id, cabin });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
