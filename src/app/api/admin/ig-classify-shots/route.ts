// Look at the photographs that can reach Instagram and record what each
// shows (see src/lib/ig-shots.ts). Run repeatedly until remaining is 0.
//
//   GET /api/admin/ig-classify-shots?limit=40        classify up to 40 unknown
//   GET /api/admin/ig-classify-shots?sync=1          add the cleared yachts'
//                                                    exterior photographs to the
//                                                    ig_photos library (feed pool)
//   GET /api/admin/ig-classify-shots?report=1        counts only, no vision calls
//
// Auth: requireUser (cookie or Bearer CRON_SECRET). Only yachts cleared by the
// outward policy are ever read here; a website-only yacht has no photograph
// in this index and none in the library.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireUser } from "@/lib/require-user";
import { fetchFleetPool } from "@/lib/sanity-fleet";
import { ensureShots, loadShots, igFriendlyUrl } from "@/lib/ig-shots";
import { socialBlockReason, yachtSlugFromFilename } from "@/lib/social-policy";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function dims(u: string): { width: number | null; height: number | null } {
  const m = String(u).match(/-(\d+)x(\d+)\.(?:jpg|jpeg|png|webp)(?:\?|$)/i);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: null, height: null };
}

export async function GET(request: Request) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const limit = Math.max(0, Math.min(120, Number(url.searchParams.get("limit") ?? 40)));
  const sync = url.searchParams.get("sync") === "1";
  const reportOnly = url.searchParams.get("report") === "1";

  const sb = createServiceClient();
  const pool = await fetchFleetPool(); // cleared yachts only, retired excluded
  const items: Array<{ url: string; slug?: string | null }> = [];
  for (const y of pool) {
    for (const img of y.images ?? []) {
      if (img?.url) items.push({ url: img.url, slug: y.slug ?? null });
    }
  }
  const { data: lib } = await sb.from("ig_photos").select("id, filename, public_url").limit(2000);
  for (const p of lib ?? []) {
    const slug = yachtSlugFromFilename(p.filename);
    if (slug && (await socialBlockReason(slug, "instagram"))) continue;
    if (p.public_url) items.push({ url: p.public_url, slug });
  }

  const result = reportOnly
    ? { shots: await loadShots(items.map((i) => i.url)), classified: 0, remaining: 0 }
    : await ensureShots(items, limit);
  if (reportOnly) {
    result.remaining = items.filter((i) => !result.shots.has(i.url)).length;
  }
  const counts: Record<string, number> = {};
  for (const s of result.shots.values()) counts[s] = (counts[s] ?? 0) + 1;

  // Per yacht: how many exteriors are known, so the carousel gate is visible.
  const perYacht = pool
    .map((y) => ({
      slug: y.slug,
      exterior: (y.images ?? []).filter((i) => i?.url && result.shots.get(i.url) === "exterior").length,
      deck: (y.images ?? []).filter((i) => i?.url && result.shots.get(i.url) === "deck").length,
      total: (y.images ?? []).length,
    }))
    .sort((a, b) => a.exterior - b.exterior);

  let synced = 0;
  const pendingInserts: Array<Record<string, unknown>> = [];
  if (sync) {
    const existing = new Set((lib ?? []).map((p) => p.public_url));
    for (const y of pool) {
      if (!y.slug) continue;
      let added = 0;
      (y.images ?? []).forEach((img, idx) => {
        if (added >= 3 || idx === 0) return; // the hero leads her carousel; the feed takes the others
        const u = img?.url;
        if (!u || existing.has(u) || !igFriendlyUrl(u)) return;
        if (result.shots.get(u) !== "exterior") return;
        existing.add(u);
        added += 1;
        synced += 1;
        const d = dims(u);
        pendingInserts.push({
          filename: `sanity-${y.slug}-${idx}.jpg`,
          storage_path: `sanity/${y.slug}/${idx}`,
          public_url: u,
          width: d.width,
          height: d.height,
          description: `${y.name}, ${[y.builder, y.length].filter(Boolean).join(" ")}, seen from outside, cruising Greek waters. Exterior photograph of a crewed charter yacht of the George Yachts fleet.`,
          tags: ["fleet", "exterior", y.slug],
          uploaded_at: new Date().toISOString(),
        });
      });
    }
    if (pendingInserts.length > 0) {
      const { error } = await sb.from("ig_photos").insert(pendingInserts.splice(0));
      if (error) return NextResponse.json({ error: error.message, synced: 0 }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: items.length,
    classified_now: result.classified,
    remaining: result.remaining,
    counts,
    yachts_ready_for_carousel: perYacht.filter((y) => y.exterior >= 3).length,
    yachts_total: pool.length,
    fewest_exteriors: perYacht.slice(0, 8),
    synced_to_library: synced,
  });
}

