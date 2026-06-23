// POST /api/helm/:id/yachts — curate the combined shortlist (admin-gated):
//   { action: "remove",  index } → drop that yacht AND remap its index-keyed media
//   { action: "feature", index } → pin that yacht as the lead / cover
//   { action: "unfeature" }      → clear the lead pin
//
// The non-featured yachts keep the deterministic cheapest→priciest price-ladder
// (the proposal's value narrative). featured_index is stored inside `extraction`
// so it survives refresh; the generate route reads it to pin the lead.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, updateRequest } from "@/lib/helm-admin";

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
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = body?.action;

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ex: any = (r.extraction && typeof r.extraction === "object") ? r.extraction : {};
  const yachts: unknown[] = Array.isArray(ex.yachts) ? ex.yachts : [];
  const featured: number | null = typeof ex.featured_index === "number" ? ex.featured_index : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const media: Record<string, any> = (r.combined_media && typeof r.combined_media === "object") ? r.combined_media : {};

  if (action === "remove") {
    const idx = Number(body?.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= yachts.length) {
      return NextResponse.json({ error: "bad index" }, { status: 400 });
    }
    const newYachts = yachts.filter((_, i) => i !== idx);
    // Remap index-keyed media: drop idx, shift everything above it down by one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newMedia: Record<string, any> = {};
    for (const k of Object.keys(media)) {
      const ki = Number(k);
      if (!Number.isInteger(ki)) continue;
      if (ki < idx) newMedia[String(ki)] = media[k];
      else if (ki > idx) newMedia[String(ki - 1)] = media[k];
      // ki === idx → dropped
    }
    let newFeatured = featured;
    if (featured !== null) {
      if (featured === idx) newFeatured = null;
      else if (featured > idx) newFeatured = featured - 1;
    }
    await updateRequest(id, {
      extraction: { ...ex, yachts: newYachts, featured_index: newFeatured },
      combined_media: newMedia,
    });
    return NextResponse.json({ ok: true, total: newYachts.length, featured_index: newFeatured });
  }

  if (action === "feature") {
    const idx = Number(body?.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= yachts.length) {
      return NextResponse.json({ error: "bad index" }, { status: 400 });
    }
    await updateRequest(id, { extraction: { ...ex, featured_index: idx } });
    return NextResponse.json({ ok: true, featured_index: idx });
  }

  if (action === "unfeature") {
    await updateRequest(id, { extraction: { ...ex, featured_index: null } });
    return NextResponse.json({ ok: true, featured_index: null });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
