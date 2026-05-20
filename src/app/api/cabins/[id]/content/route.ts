// PATCH /api/cabins/:id/content
// Body: { crew_display?, sample_menu?, inspiration_content? }
//
// Updates the JSONB content fields shown in the client Cabin
// (crew list, sample menu, inspiration). Each is a free-form
// JSON blob — validated by being parseable JSON at the call site,
// no rigid schema beyond that.

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

// 2026-05-20 — Friend-test pass 4: added vessel_photos so George
// can paste public photo URLs for the vessel from the GY Command
// content page. Stored as JSONB array of { url, caption?, credit? }.
const ALLOWED = new Set([
  "crew_display",
  "sample_menu",
  "inspiration_content",
  "vessel_brochure",
  "vessel_photos",
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await adminEmail();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (ALLOWED.has(k)) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no-allowed-fields" }, { status: 400 });
  }

  const db = createServiceClient();
  const { error } = await db.from("cabins").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("cabin_audit_log").insert({
    cabin_id: id,
    actor_email: me.toLowerCase(),
    actor_role: "admin",
    action: "cabin_updated",
    metadata: { keys: Object.keys(patch), area: "client_content" },
  });

  return NextResponse.json({ ok: true });
}
