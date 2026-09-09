// POST /api/helm/:id/extract — run the AI extractor over supplier_raw and
// store the raw result (numbers + verbatim snippets + confidence + flags).
// NOTHING is computed or sent here — this only fills the review screen.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, saveExtraction } from "@/lib/helm-admin";
import { extractSupplier, extractSupplierYachts } from "@/lib/helm/extract";

export const runtime = "nodejs";
export const maxDuration = 300;

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

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (!r.supplier_raw || !String(r.supplier_raw).trim()) {
    return NextResponse.json({ error: "No supplier text on this request to extract from." }, { status: 400 });
  }

  // The charter dates pick the season tier and the area resolves a conditional
  // VAT, deterministically, inside the extractor (supplier-parse.ts).
  const rr = r as unknown as { dates_from?: string | null; dates_to?: string | null; area?: string | null; extraction?: unknown };
  const xctx = { dates_from: rr.dates_from ?? null, dates_to: rr.dates_to ?? null, area: rr.area ?? null };

  // A re-extract rebuilds the YACHT LIST. It must never erase the request's
  // history that also lives in the extraction JSON: the follow-up plan
  // (pipeline), magazine views (salon), opens, the imported supplier threads,
  // the owner's terms / charter type / white-label choice. Until 2026-09-09 a
  // re-extract replaced the whole column and silently wiped all of that.
  // featured_index is the one key dropped on purpose: it indexes the OLD card
  // order, and a stale pin put the wrong yacht on the cover.
  const keepRequestHistory = (fresh: object) => {
    const prev = (rr.extraction && typeof rr.extraction === "object") ? (rr.extraction as Record<string, unknown>) : {};
    const { featured_index: _staleCover, ...history } = prev;
    void _staleCover;
    return { ...history, ...fresh };
  };

  try {
    // Combined mode → extract EVERY yacht the supplier offered (array, each
    // with its own numbers + snippets + confidence + STOP flags). Single mode
    // → one yacht as before. NOTHING is computed here.
    if (r.mode === "combined") {
      // CombinedExtraction = { yachts, suggested_charter_type?, suggested_terms? }.
      // The panel pre-selects the auto-detected charter type + seeds the terms
      // editor from the suggestions (the owner confirms / edits / clears).
      const fresh = await extractSupplierYachts(r.supplier_raw, r.brief || undefined, xctx);
      const extraction = keepRequestHistory(fresh);
      await saveExtraction(id, extraction);
      return NextResponse.json({ ok: true, extraction });
    }
    const fresh = await extractSupplier(r.supplier_raw, r.brief || undefined, xctx);
    const extraction = keepRequestHistory(fresh);
    await saveExtraction(id, extraction);
    return NextResponse.json({ ok: true, extraction });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
