// POST /api/helm/:id/scan-yachts — Phase 1 of the two-phase picker (2026-07-18).
// Given ONE supplier email, return just the list of yacht TITLES (name + a short
// recognisable line) so George ticks the ones he wants before any heavy detailed
// extraction runs. Tiny output → never truncates, even for a 12-yacht email.
// Reads nothing, saves nothing — pure scan.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest } from "@/lib/helm-admin";
import { scanSupplierYachts } from "@/lib/helm/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  // useImported → scan the supplier email(s) already imported from Gmail (their
  // brochures are already transcribed into supplier_raw). Otherwise a fresh paste.
  const useImported = body?.useImported === true;
  const text = (useImported ? (r.supplier_raw ?? "") : (body?.text ?? "")).toString().trim();
  if (!text) {
    return NextResponse.json(
      { error: useImported ? "No supplier emails imported yet — import them from Gmail below first." : "Paste the supplier email first." },
      { status: 400 },
    );
  }

  try {
    const yachts = await scanSupplierYachts(text);
    if (!yachts.length) {
      return NextResponse.json({ error: "No yachts found in this email. Check the text and try again." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, yachts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
