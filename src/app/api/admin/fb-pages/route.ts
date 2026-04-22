// One-off diagnostic: lists the Pages the IG_ACCESS_TOKEN user manages
// and their per-page access tokens. First call also seeds the cached
// Page token in settings.fb_page_token so the mirror cron can run.
//
// Hit once, confirm the George Yachts Page appears, then discard.

import { NextResponse } from "next/server";
import { listPages } from "@/lib/facebook-client";

export const runtime = "nodejs";

export async function GET() {
  const json = await listPages();
  // Strip tokens from the response for safety — they're sensitive.
  const safe = {
    ...json,
    data: (json.data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      has_access_token: !!p.access_token,
      tasks: p.tasks,
    })),
  };
  return NextResponse.json(safe);
}
