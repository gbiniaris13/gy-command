// POST /api/cabins/:id/refresh-nearby
// =============================================================
// 2026-05-23 — Berth Map Phase 2.
// Manually re-fetch the cached "around your berth" info (airport,
// helipad, ATMs, hospital, pharmacy) for a cabin.
//
// Normally fired automatically by updateCabin() when berth_lat or
// berth_lng change. This endpoint is for the explicit "Refresh
// nearby" button in EditBasicsForm — useful if a new ATM opens at
// the marina, or if a previous fetch failed (Overpass outage).
//
// Always returns 200 unless auth/coords are missing; partial
// results are flagged in the response body. Never destroys
// previously-good cached data on transient API failures.
// =============================================================

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase-server";
import { refreshBerthNearby } from "@/lib/cabin-admin";

export const runtime = "nodejs";
// 30s ceiling — Overpass + OSRM + 5 parallel queries fit easily
// inside this even on a cold-start.
export const maxDuration = 30;

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

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Read the cabin's current berth coords from DB rather than
  // trusting the client — single source of truth.
  const db = createServiceClient();
  const { data: cabin, error } = await db
    .from("cabins")
    .select("berth_lat, berth_lng")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!cabin) {
    return NextResponse.json({ error: "cabin-not-found" }, { status: 404 });
  }

  const lat = Number(cabin.berth_lat);
  const lng = Number(cabin.berth_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: "no-berth-coordinates" },
      { status: 400 },
    );
  }

  const result = await refreshBerthNearby(id, lat, lng);
  return NextResponse.json(result);
}
