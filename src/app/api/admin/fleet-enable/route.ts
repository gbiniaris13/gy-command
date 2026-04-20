// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// GET /api/admin/fleet-enable?value=true|false
//
// Toggles the fleet_posts_enabled flag in the settings KV table.
// Also exposes GET with no query param = read current value.
//
// Read-only callers: ?value=<nothing> → returns current state.
// Writers: ?value=true|false → upserts.
//
// No auth — same pattern as the other /api/admin/* endpoints in this
// repo. Safe to hit repeatedly (idempotent).

const KEY = "fleet_posts_enabled";

export async function GET(req: NextRequest) {
  const sb = createServiceClient();
  const url = new URL(req.url);
  const value = url.searchParams.get("value");

  if (value === null) {
    const { data } = await sb
      .from("settings")
      .select("value, updated_at")
      .eq("key", KEY)
      .maybeSingle();
    return NextResponse.json({
      key: KEY,
      value: data?.value ?? null,
      updated_at: data?.updated_at ?? null,
    });
  }

  if (value !== "true" && value !== "false") {
    return NextResponse.json(
      { error: "value must be 'true' or 'false'" },
      { status: 400 },
    );
  }

  const { error } = await sb
    .from("settings")
    .upsert(
      { key: KEY, value, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, key: KEY, value });
}
