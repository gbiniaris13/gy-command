// Every 30 minutes: papers arriving by Gmail from won clients (or forwarded
// by George with "GY INBOX" in the subject) file themselves. `?dry=1` previews.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { observeCron } from "@/lib/cron-observer";
import { scanGmailForPapers } from "@/lib/helm/inbox-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = await requireUser(req);
  if (denied) return denied;
  if (new URL(req.url).searchParams.get("dry") === "1") return NextResponse.json({ ok: true, ...(await scanGmailForPapers({ dryRun: true })) });
  return observeCron("inbox-documents", async () => {
    const r = await scanGmailForPapers();
    if (!r.filed.length && !r.pending.length) return NextResponse.json({ skipped: "nothing new", looked_at: r.looked_at });
    return NextResponse.json({ ok: true, ...r });
  });
}
