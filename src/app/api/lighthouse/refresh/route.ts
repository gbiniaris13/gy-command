// @ts-nocheck
import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/google-api";
import { recomputeCache } from "../route";

// The Lighthouse background refresher. GET /api/lighthouse always
// answers instantly from the stored snapshot (George 29/8: "τα
// τραβάει ΜΙΑ φορά, τα έχει και έτοιμα"); when that snapshot is
// stale the dashboard fires THIS endpoint without waiting on it, the
// recompute happens here off George's critical path, and the next
// poll picks up the fresh truth. A 90s latch stops overlapping
// dashboards from paying for duplicate recomputes.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const CACHE_KEY = "lighthouse_cache_v1";

export async function POST(request) {
  const { requireUser } = await import("@/lib/require-user");
  const denied = await requireUser(request);
  if (denied) return denied;
  try {
    const raw = await getSetting(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached?.payload && !cached.stale && Date.now() - cached.at < 10 * 60 * 1000) {
        return NextResponse.json({ ok: true, skipped: "fresh" });
      }
      if (cached?.refreshing_at && Date.now() - cached.refreshing_at < 90 * 1000) {
        return NextResponse.json({ ok: true, skipped: "already refreshing" });
      }
      if (cached?.payload) {
        await setSetting(CACHE_KEY, JSON.stringify({ ...cached, refreshing_at: Date.now() }));
      }
    }
  } catch {}
  await recomputeCache();
  return NextResponse.json({ ok: true, refreshed: true });
}
