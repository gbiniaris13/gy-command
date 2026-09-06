// Generic settings flag endpoint — read or upsert a single key/value
// row in the `settings` table.
//
// 2026-05-07 — added so the IG yacht-rotation flags can be flipped
// without a Supabase dashboard round-trip:
//   POST /api/admin/setting   { key: "fleet_posts_enabled", value: "true" }
//   GET  /api/admin/setting?key=fleet_posts_enabled
//
// Auth: same as other /api/admin/* endpoints — public per code, gated
// by Vercel deployment protection at the platform layer.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireUser } from "@/lib/require-user";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key required" }, { status: 400 });
  }
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("settings")
    .select("key, value, updated_at")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ key, value: data?.value ?? null, updated_at: data?.updated_at ?? null });
}

export async function POST(req: NextRequest) {
  const denied = await requireUser(req);
  if (denied) return denied;
  let body: { key?: unknown; value?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) {
    return NextResponse.json({ error: "key required (string)" }, { status: 400 });
  }
  // Coerce non-string values to JSON-encoded strings so the column
  // (text) can store them. Most settings consumers in the codebase
  // expect string-ish values.
  const value =
    typeof body.value === "string"
      ? body.value
      : body.value === undefined
        ? null
        : JSON.stringify(body.value);

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("settings")
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, setting: data });
}
