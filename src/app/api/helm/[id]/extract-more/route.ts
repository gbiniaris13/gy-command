// POST /api/helm/:id/extract-more — a SECOND (or third) supplier replied later
// with more yachts. Extracts yachts from ONLY the pasted text and APPENDS them
// to the existing extraction, so the broker's finished work on the earlier
// yachts (confirmed prices, photos, brochures — all keyed by index) stays
// untouched: existing indexes never move, new yachts take the next indexes.
// Also appends the pasted text to supplier_raw so the record keeps the full
// supplier history. Combined mode only. Nothing is computed or sent here.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, saveExtraction } from "@/lib/helm-admin";
import { createServiceClient } from "@/lib/supabase-server";
import { extractSupplierYachts } from "@/lib/helm/extract";

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
  if (r.mode !== "combined") {
    return NextResponse.json({ error: "Adding more yachts works on combined (multi-yacht) requests." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const text = (body?.text ?? "").toString().trim();
  if (!text) return NextResponse.json({ error: "Paste the new supplier's email first." }, { status: 400 });

  try {
    // Extract ONLY from the new text — the earlier yachts are never re-extracted.
    // The returned envelope carries the new yachts (+ proposal-level suggestions);
    // we APPEND only the yachts and never disturb the existing cards/suggestions.
    const result = await extractSupplierYachts(text, r.brief || undefined);
    const added = result.yachts;
    if (!added.length) {
      return NextResponse.json({ error: "No yachts found in the pasted text. Check it and try again." }, { status: 400 });
    }

    const ex = (r.extraction && typeof r.extraction === "object") ? r.extraction : {};
    const existing = Array.isArray(ex.yachts) ? ex.yachts : [];
    // Preserve the existing proposal-level suggestions / settings (charter type,
    // terms, white_label, featured_index, …) — only the yacht list grows.
    const extraction = { ...ex, yachts: [...existing, ...added] };
    await saveExtraction(id, extraction);

    // Keep the full supplier history on the record (internal only).
    const db = createServiceClient();
    const sep = "\n\n----- ADDITIONAL SUPPLIER (added later) -----\n\n";
    await db
      .from("helm_requests")
      .update({
        supplier_raw: r.supplier_raw ? `${r.supplier_raw}${sep}${text}` : text,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json({ ok: true, added: added.length, total: extraction.yachts.length, extraction });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
