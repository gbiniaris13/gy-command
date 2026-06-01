// POST /api/helm/:id/extract — run the AI extractor over supplier_raw and
// store the raw result (numbers + verbatim snippets + confidence + flags).
// NOTHING is computed or sent here — this only fills the review screen.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, saveExtraction } from "@/lib/helm-admin";
import { extractSupplier, extractSupplierYachts } from "@/lib/helm/extract";

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

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (!r.supplier_raw || !String(r.supplier_raw).trim()) {
    return NextResponse.json({ error: "No supplier text on this request to extract from." }, { status: 400 });
  }

  try {
    // Combined mode → extract EVERY yacht the supplier offered (array, each
    // with its own numbers + snippets + confidence + STOP flags). Single mode
    // → one yacht as before. NOTHING is computed here.
    if (r.mode === "combined") {
      const yachts = await extractSupplierYachts(r.supplier_raw, r.brief || undefined);
      const extraction = { yachts };
      await saveExtraction(id, extraction);
      return NextResponse.json({ ok: true, extraction });
    }
    const extraction = await extractSupplier(r.supplier_raw, r.brief || undefined);
    await saveExtraction(id, extraction);
    return NextResponse.json({ ok: true, extraction });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
