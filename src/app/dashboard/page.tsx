// /dashboard — GY Cockpit. The ONE page.
//
// Replaces the previous 14-widget dashboard with a single
// action-prescribing surface. Server component reads the cached
// briefing (built by /api/cron/cockpit-briefing 06:00 Athens), client
// component handles draft generation + brainstorm chat.
//
// Old kitchen-sink dashboard preserved at /dashboard/legacy for
// drill-down access. Other dashboard sections (contacts, fleet,
// instagram, etc.) remain at their existing routes.

import Link from "next/link";
import { createServiceClient } from "@/lib/supabase-server";
import { buildBriefing, type CockpitBriefing } from "@/lib/cockpit-engine";
import CockpitClient from "./CockpitClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadBriefing(): Promise<CockpitBriefing | null> {
  try {
    const sb = createServiceClient();
    const today = new Date().toISOString().slice(0, 10);
    // Try cache first (built by 06:00 cron)
    const { data: cached } = await sb
      .from("settings")
      .select("value")
      .eq("key", `cockpit_briefing_${today}`)
      .maybeSingle();
    if (cached?.value) {
      try {
        return JSON.parse(cached.value as string) as CockpitBriefing;
      } catch {
        /* fall through */
      }
    }
    // Build live if cache miss
    return await buildBriefing(sb);
  } catch (e) {
    console.error("[dashboard] briefing load failed:", e);
    return null;
  }
}

export default async function CockpitPage() {
  const briefing = await loadBriefing();

  if (!briefing) {
    return (
      <div className="min-h-screen bg-black text-white p-8">
        <h1 className="font-serif text-3xl">Cockpit unavailable</h1>
        <p className="mt-2 text-white/60 text-sm">
          Briefing failed to load. Try{" "}
          <Link href="/api/cockpit/briefing?fresh=1" className="text-[#DAA520] underline">
            forcing a refresh
          </Link>{" "}
          or check the runtime logs.
        </p>
        <Link href="/dashboard/legacy" className="mt-6 inline-block text-[#DAA520] underline">
          → Open legacy dashboard
        </Link>
      </div>
    );
  }

  return <CockpitClient briefing={briefing} />;
}
