// POST /api/helm — create a new charter request (The Helm intake).
// Manual intake only: George pastes the client brief + the raw
// supplier email. Upserts the contact by email, inserts the request
// in status 'new'.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createRequest } from "@/lib/helm-admin";

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

export async function POST(req: Request) {
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  // A request needs at least something to identify it.
  if (!body.client_name && !body.client_email && !body.supplier_raw) {
    return NextResponse.json(
      { error: "need at least a client name, email, or supplier text" },
      { status: 400 },
    );
  }

  try {
    const request = await createRequest({ ...body, actorEmail: email });
    return NextResponse.json({ ok: true, id: request.id, request });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
