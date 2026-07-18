// POST /api/helm/:id/extract-picked — Phase 2 of the two-phase picker
// (2026-07-18). Given the supplier email + the yacht NAMES George ticked, extract
// full detail for ONLY those and APPEND them to the request (existing yachts and
// all the broker's work on them are untouched — new yachts take the next
// indexes). Turns the request into combined mode and keeps the supplier text on
// the record. Nothing is computed or sent here.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, saveExtraction } from "@/lib/helm-admin";
import { createServiceClient } from "@/lib/supabase-server";
import { extractPickedYachts } from "@/lib/helm/extract";

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

const norm = (n: unknown) => String(n ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const text = (body?.text ?? "").toString().trim();
  const names = Array.isArray(body?.names) ? (body.names as unknown[]).map(String).filter(Boolean) : [];
  if (!text) return NextResponse.json({ error: "The supplier email is missing." }, { status: 400 });
  if (!names.length) return NextResponse.json({ error: "Tick at least one yacht to add." }, { status: 400 });

  try {
    const result = await extractPickedYachts(text, names, r.brief || undefined);
    const added = result.yachts;
    if (!added.length) {
      return NextResponse.json({ error: "Could not extract the picked yachts from this email. Try again." }, { status: 400 });
    }

    const ex = (r.extraction && typeof r.extraction === "object") ? (r.extraction as Record<string, unknown>) : {};
    const existing = Array.isArray(ex.yachts) ? (ex.yachts as { vessel_name?: { value?: unknown } }[]) : [];
    // De-dup by vessel name so a re-scan of the same email never doubles a yacht;
    // existing indexes (and all the broker's work keyed by index) never move.
    const have = new Set(existing.map((y) => norm(y?.vessel_name?.value)));
    const fresh = (added as { vessel_name?: { value?: unknown } }[]).filter((y) => {
      const k = norm(y?.vessel_name?.value);
      if (!k || have.has(k)) return false;
      have.add(k);
      return true;
    });
    if (!fresh.length) {
      return NextResponse.json({ error: "Those yachts are already on this proposal." }, { status: 400 });
    }

    const extraction: Record<string, unknown> = { ...ex, yachts: [...existing, ...fresh] };
    if (!ex.suggested_charter_type && result.suggested_charter_type) extraction.suggested_charter_type = result.suggested_charter_type;
    if (!ex.suggested_terms && result.suggested_terms) extraction.suggested_terms = result.suggested_terms;
    await saveExtraction(id, extraction);

    // Combined mode (so the yacht cards render) + keep the supplier text on record.
    const db = createServiceClient();
    const sep = "\n\n----- SUPPLIER EMAIL (picked yachts) -----\n\n";
    await db.from("helm_requests").update({
      mode: "combined",
      supplier_raw: r.supplier_raw ? `${r.supplier_raw}${sep}${text}` : text,
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    return NextResponse.json({
      ok: true,
      added: fresh.length,
      total: (extraction.yachts as unknown[]).length,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
