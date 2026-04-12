import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET() {
  const sb = createServiceClient();

  const { data: contacts } = await sb
    .from("contacts")
    .select("id, first_name, last_name, company, source, last_activity_at, pipeline_stage:pipeline_stages(name)")
    .or("source.eq.partner,source.eq.referral,notes.ilike.%partnership%")
    .order("last_activity_at", { ascending: false })
    .limit(20);

  const now = Date.now();
  const partners = (contacts ?? []).map((c) => {
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed";
    const stageData = c.pipeline_stage as unknown as { name: string } | { name: string }[] | null;
    const stage = Array.isArray(stageData) ? stageData[0]?.name ?? "New" : stageData?.name ?? "New";
    const daysIdle = c.last_activity_at
      ? Math.floor((now - new Date(c.last_activity_at).getTime()) / 86400000)
      : 999;

    let status: string;
    if (stage === "Closed Won") status = "ACTIVE";
    else if (daysIdle > 10) status = "STALE";
    else if (daysIdle > 5 && (stage === "Warm" || stage === "Hot")) status = "URGENT";
    else if (stage === "Warm" || stage === "Hot" || stage === "Meeting Booked") status = "WARM";
    else if (stage === "Contacted" || stage === "Proposal Sent") status = "SENT";
    else status = "NEW";

    return { id: c.id, name, company: c.company, stage, last_activity_at: c.last_activity_at, days_idle: daysIdle, status };
  });

  // Sort: URGENT first, then STALE, then rest
  const order: Record<string, number> = { URGENT: 0, STALE: 1, WARM: 2, NEW: 3, SENT: 4, ACTIVE: 5 };
  partners.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  return NextResponse.json({ partners });
}
