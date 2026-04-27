// /api/admin/religion-infer — populates contacts.inferred_religion
// using the heuristic in pillar3-religion-inferrer.ts.
//
// Skips contacts where religion_overridden=true (George corrected
// it manually). Cheap (no AI calls). Idempotent — re-run anytime
// to pick up newly-added country/name data.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { inferReligion } from "@/lib/pillar3-religion-inferrer";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const dry = sp.get("dry") === "1";
  const sb = createServiceClient();

  // Walk all contacts, group required updates by target religion,
  // then issue ONE bulk update per religion group via .in('id', […]).
  // Avoids the 1800 round-trips that hit Vercel's 300s cap.
  const counts: Record<string, number> = {};
  let skipped = 0;
  const updatesByReligion = new Map<string, string[]>();

  const PAGE = 1000;
  let p = 0;
  while (true) {
    const { data: rows, error } = await sb
      .from("contacts")
      .select(
        "id, country, first_name, last_name, email, inferred_religion, religion_overridden",
      )
      .order("created_at", { ascending: true })
      .range(p * PAGE, (p + 1) * PAGE - 1);
    if (error || !rows || rows.length === 0) break;

    for (const c of rows) {
      if (c.religion_overridden) {
        skipped++;
        continue;
      }
      const rel = inferReligion({
        country: c.country as string | null,
        first_name: c.first_name as string | null,
        last_name: c.last_name as string | null,
        email: c.email as string | null,
      });
      counts[rel] = (counts[rel] ?? 0) + 1;
      if (rel !== c.inferred_religion) {
        const list = updatesByReligion.get(rel) ?? [];
        list.push(c.id as string);
        updatesByReligion.set(rel, list);
      }
    }
    if (rows.length < PAGE) break;
    p++;
  }

  let updated = 0;
  if (!dry) {
    for (const [rel, ids] of updatesByReligion.entries()) {
      // Chunk to keep PostgREST URL length reasonable.
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        await sb
          .from("contacts")
          .update({ inferred_religion: rel })
          .in("id", slice);
        updated += slice.length;
      }
    }
  } else {
    for (const ids of updatesByReligion.values()) updated += ids.length;
  }

  return NextResponse.json({
    ok: true,
    dry,
    updated,
    skipped_overridden: skipped,
    by_religion: counts,
  });
}
