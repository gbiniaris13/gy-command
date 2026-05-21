// PATCH /api/cabins/:id — update arbitrary fields on a cabin.
// Used by the detail page for status changes (draft → invited →
// active → in_voyage → completed → archived) and other tweaks.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { updateCabin, deleteCabin } from "@/lib/cabin-admin";

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

const ALLOWED_FIELDS = new Set([
  "status",
  "vessel_name", "vessel_make_model", "vessel_length", "vessel_capacity", "homeport",
  "charter_period_from", "charter_period_to",
  "port_embarkation", "port_disembarkation", "cruising_area",
  "principal_charterer_name", "principal_charterer_mobile",
  "captain_name_internal", "chef_name_internal", "hostess_name_internal",
  "central_agent_internal", "vessel_owner_internal",
  "charter_fee_eur", "apa_eur",
  "myba_contract_number",
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(k)) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no-allowed-fields" }, { status: 400 });
  }

  try {
    const cabin = await updateCabin(id, patch, email);
    return NextResponse.json({ ok: true, cabin });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// 2026-05-21 — Pass 7 follow-up:
//   DELETE /api/cabins/:id?mode=soft  (default) — set deleted_at
//   DELETE /api/cabins/:id?mode=hard           — actual DELETE,
//     cascades to operational tables but preserves audit / consents
//     / time capsules / Filotimo record.
//
//   See lib/cabin-admin.ts deleteCabin() for the full semantics.
//   This route just authenticates the admin session, parses the
//   mode, and forwards.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const mode: "soft" | "hard" =
    url.searchParams.get("mode") === "hard" ? "hard" : "soft";

  try {
    const result = await deleteCabin(id, email, mode);
    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    const status = msg === "cabin-not-found" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
