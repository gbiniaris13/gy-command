// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// Returns the list of contacts that need a follow-up touch, ranked by how
// overdue they are. Powers the FollowUpWidget on the main dashboard.
//
// "Needs follow-up" = contact currently in the Contacted or Warm stage
// whose last_activity_at is older than FOLLOWUP_INTERVAL_DAYS days.
// The widget classifies each item as overdue / due_today / upcoming.

const FOLLOWUP_INTERVAL_DAYS = 4; // Bot sends follow-up 1 after ~4 days

export async function GET() {
  const sb = createServiceClient();

  // Resolve the stage IDs we care about once.
  const { data: stages } = await sb
    .from("pipeline_stages")
    .select("id, name")
    .in("name", ["Contacted", "Warm"]);

  const stageIds = (stages ?? []).map((s) => s.id);
  if (stageIds.length === 0) {
    return NextResponse.json({ items: [], total: 0 });
  }
  const stageNameById = new Map((stages ?? []).map((s) => [s.id, s.name]));

  // Pull candidates — contacts sitting in those stages for a while.
  // Limit to a sane ceiling so the widget can't blow up on huge lists.
  const { data: contacts } = await sb
    .from("contacts")
    .select(
      "id, first_name, last_name, company, last_activity_at, pipeline_stage_id, source"
    )
    .in("pipeline_stage_id", stageIds)
    .order("last_activity_at", { ascending: true })
    .limit(200);

  const now = Date.now();
  const interval = FOLLOWUP_INTERVAL_DAYS * 86400000;

  const items = (contacts ?? [])
    .map((c) => {
      const lastTs = c.last_activity_at
        ? new Date(c.last_activity_at).getTime()
        : now;
      const daysSince = Math.floor((now - lastTs) / 86400000);
      const deltaMs = now - lastTs;

      let urgency: "overdue" | "due_today" | "upcoming";
      let daysField: number;
      if (deltaMs > interval + 86400000) {
        urgency = "overdue";
        daysField = daysSince - FOLLOWUP_INTERVAL_DAYS;
      } else if (deltaMs >= interval - 86400000 && deltaMs <= interval + 86400000) {
        urgency = "due_today";
        daysField = 0;
      } else {
        urgency = "upcoming";
        daysField = Math.max(
          0,
          FOLLOWUP_INTERVAL_DAYS - daysSince
        );
      }

      return {
        id: c.id,
        name:
          [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed",
        company: c.company,
        last_activity_at: c.last_activity_at,
        stage: stageNameById.get(c.pipeline_stage_id) ?? "Contacted",
        days_idle: daysField,
        urgency,
      };
    })
    // Hide items that are still fresh — the widget only surfaces things
    // that are due within ~1 day or already overdue.
    .filter((item) => item.urgency !== "upcoming" || item.days_idle <= 1)
    .sort((a, b) => {
      const rank = { overdue: 0, due_today: 1, upcoming: 2 } as const;
      if (rank[a.urgency] !== rank[b.urgency])
        return rank[a.urgency] - rank[b.urgency];
      return b.days_idle - a.days_idle;
    })
    .slice(0, 25);

  return NextResponse.json({ items, total: items.length });
}
