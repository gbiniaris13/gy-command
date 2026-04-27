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

  // Walk all contacts (paginated past the 1000-row Supabase cap).
  const counts: Record<string, number> = {};
  let updated = 0;
  let skipped = 0;
  const PAGE = 1000;
  let p = 0;
  while (true) {
    const { data: rows, error } = await sb
      .from("contacts")
      .select(
        "id, country, first_name, inferred_religion, religion_overridden",
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
      });
      counts[rel] = (counts[rel] ?? 0) + 1;
      if (rel !== c.inferred_religion) {
        if (!dry) {
          await sb
            .from("contacts")
            .update({ inferred_religion: rel })
            .eq("id", c.id);
        }
        updated++;
      }
    }
    if (rows.length < PAGE) break;
    p++;
  }

  return NextResponse.json({
    ok: true,
    dry,
    updated,
    skipped_overridden: skipped,
    by_religion: counts,
  });
}
