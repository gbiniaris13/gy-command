// PUT /api/cabins/:id/manifest — full replace of guest manifest rows.
//
// Body: { guests: Array<{
//   full_name, date_of_birth, nationality, passport_number,
//   passport_expiry, is_minor, email, mobile, cabin_pairing,
//   shoe_size, allergies_dietary
// }> }
//
// We delete every row then re-insert in order. Audit trail captured
// at the cabin level. The captain's port-authority paperwork depends
// on this; we keep the API blunt and reliable instead of a fancy
// diff/upsert that could leave the manifest in an inconsistent state.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase-server";

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

type Guest = {
  full_name?: string | null;
  date_of_birth?: string | null;
  nationality?: string | null;
  passport_number?: string | null;
  passport_expiry?: string | null;
  is_minor?: boolean | null;
  email?: string | null;
  mobile?: string | null;
  cabin_pairing?: string | null;
  shoe_size?: string | null;
  allergies_dietary?: string | null;
};

function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.guests)) {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const db = createServiceClient();

  // Replace strategy. Delete existing rows for this cabin, then
  // bulk insert. cabin_guests_manifest has ON DELETE CASCADE from
  // cabins, but no FK from anything else cares about row identity.
  const { error: delErr } = await db
    .from("cabin_guests_manifest")
    .delete()
    .eq("cabin_id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const rows = (body.guests as Guest[])
    .map((g, i) => ({
      cabin_id: id,
      guest_order: i + 1,
      full_name: clean(g.full_name),
      date_of_birth: clean(g.date_of_birth),
      nationality: clean(g.nationality),
      passport_number: clean(g.passport_number),
      passport_expiry: clean(g.passport_expiry),
      is_minor: g.is_minor === true,
      email: clean(g.email),
      mobile: clean(g.mobile),
      cabin_pairing: clean(g.cabin_pairing),
      shoe_size: clean(g.shoe_size),
      allergies_dietary: clean(g.allergies_dietary),
    }))
    // Drop rows where the user clicked "add" but never typed a name.
    .filter((r) => r.full_name);

  if (rows.length === 0) {
    await db.from("cabin_audit_log").insert({
      cabin_id: id,
      actor_email: email.toLowerCase(),
      actor_role: "admin",
      action: "guest_manifest_cleared",
      metadata: { count: 0 },
    });
    return NextResponse.json({ ok: true, count: 0 });
  }

  const { error: insErr } = await db.from("cabin_guests_manifest").insert(rows);
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await db.from("cabin_audit_log").insert({
    cabin_id: id,
    actor_email: email.toLowerCase(),
    actor_role: "admin",
    action: "guest_manifest_replaced",
    metadata: { count: rows.length },
  });

  return NextResponse.json({ ok: true, count: rows.length });
}
