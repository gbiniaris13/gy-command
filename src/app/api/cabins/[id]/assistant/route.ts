// POST   /api/cabins/:id/assistant   — add a Designated Assistant
// DELETE /api/cabins/:id/assistant   — remove (body { member_id })
//
// The Designated Assistant is a cabin_member with role=
// 'designated_assistant' and assists_member_id pointing at the
// principal charterer's member row. They can fill the brief on
// the charterer's behalf, but the charterer remains the named
// principal across every export.

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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await adminEmail();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const display_name = body?.display_name ? String(body.display_name).slice(0, 120) : null;
  if (!email.includes("@")) return NextResponse.json({ error: "invalid-email" }, { status: 400 });

  const db = createServiceClient();
  const { data: principal } = await db
    .from("cabin_members")
    .select("id")
    .eq("cabin_id", id)
    .eq("role", "principal_charterer")
    .is("deleted_at", null)
    .maybeSingle();

  if (!principal) {
    return NextResponse.json({ error: "no-principal-charterer" }, { status: 400 });
  }

  // Defend against re-adding a previously-removed assistant: the
  // unique constraint is on (cabin_id, email) regardless of
  // deleted_at, so we must explicitly clear deleted_at on conflict.
  // Also refuse if the email is held by someone in a different role
  // on the same cabin (e.g. the principal themselves) — silently
  // overwriting that role would be a privilege accident.
  const { data: existing } = await db
    .from("cabin_members")
    .select("id, role, deleted_at")
    .eq("cabin_id", id)
    .eq("email", email)
    .maybeSingle();

  if (existing && existing.role && existing.role !== "designated_assistant" && !existing.deleted_at) {
    return NextResponse.json({ error: "email-in-use-other-role" }, { status: 409 });
  }

  const { data: assistant, error } = await db
    .from("cabin_members")
    .upsert(
      {
        cabin_id: id,
        role: "designated_assistant",
        email,
        display_name,
        assists_member_id: principal.id,
        deleted_at: null,
      },
      { onConflict: "cabin_id,email" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("cabin_audit_log").insert({
    cabin_id: id,
    actor_email: me.toLowerCase(),
    actor_role: "admin",
    action: "designated_assistant_added",
    metadata: { assistant_email: email },
  });

  return NextResponse.json({ ok: true, assistant });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await adminEmail();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const memberId = body?.member_id;
  if (!memberId) return NextResponse.json({ error: "member_id required" }, { status: 400 });

  const db = createServiceClient();
  await db
    .from("cabin_members")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("cabin_id", id)
    .eq("role", "designated_assistant");

  await db.from("cabin_audit_log").insert({
    cabin_id: id,
    actor_email: me.toLowerCase(),
    actor_role: "admin",
    action: "designated_assistant_removed",
    metadata: { member_id: memberId },
  });

  return NextResponse.json({ ok: true });
}
