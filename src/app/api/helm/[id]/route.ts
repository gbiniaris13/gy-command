// PATCH  /api/helm/:id — update fields / status, or append a note.
// DELETE /api/helm/:id — hard delete (cascades to helm_messages).
//
// The sale is non-linear, so status transitions are permissive but
// guarded: the value must be a valid helm_status, and moving to
// 'lost' should carry a lost_reason (surfaced, not hard-blocked).

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { updateRequest, deleteRequest, addNote } from "@/lib/helm-admin";

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

const HELM_STATUSES = new Set([
  "new", "drafted", "sent", "in_conversation", "negotiating", "won", "lost",
]);

const ALLOWED_FIELDS = new Set([
  "status",
  "client_name", "client_email", "client_whatsapp",
  "brief", "occasion", "party_size",
  "dates_from", "dates_to", "area",
  "supplier_raw",
  "mode", "no_myba", "show_ghost_credit",
  "won_reason", "lost_reason",
  "follow_up_at",
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  // A standalone note append (channel 'note') — no field change.
  if (typeof body.note === "string" && body.note.trim() && Object.keys(body).length === 1) {
    try {
      await addNote(id, body.note.trim());
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (body.status && !HELM_STATUSES.has(body.status)) {
    return NextResponse.json({ error: `invalid status: ${body.status}` }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(k)) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no-allowed-fields" }, { status: 400 });
  }

  try {
    const request = await updateRequest(id, patch);
    // If a note also rode along with the field change, append it too.
    if (typeof body.note === "string" && body.note.trim()) {
      await addNote(id, body.note.trim());
    }
    return NextResponse.json({ ok: true, request });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await deleteRequest(id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
