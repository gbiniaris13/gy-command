// Daily 04:40 UTC (07:40 Athens): the four moments of every won charter.
// Drafts only; George presses Send. `?dry=1` shows what would happen.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { observeCron } from "@/lib/cron-observer";
import { runTimeline } from "@/lib/helm/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  if (dry) return NextResponse.json({ ok: true, ...(await runTimeline({ dryRun: true })) });
  return observeCron("charter-timeline", async () => {
    const r = await runTimeline();
    return NextResponse.json({ ok: true, ...r });
  });
}
