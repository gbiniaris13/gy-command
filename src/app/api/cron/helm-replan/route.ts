// GET /api/cron/helm-replan — hourly (16/11/2026). Re-times every open
// request's follow-up plan from the whole conversation (email, WhatsApp,
// iMessage, notes): see src/lib/helm/followup/replan.ts. Sends nothing.
// Auth: the Vercel cron secret, or the Mac sync token (for a manual run).
import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/google-api";
import { autoReplanMany } from "@/lib/helm/followup/replan";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const syncToken = await getSetting("conversation_sync_token");
  const ok = (!!process.env.CRON_SECRET && auth === process.env.CRON_SECRET) || (!!syncToken && syncToken.length >= 32 && auth === syncToken);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const force = req.nextUrl.searchParams.get("force") === "1";
  const results = await autoReplanMany("all-open", { force, concurrency: 4, deadlineMs: 270000 });
  return NextResponse.json({
    ok: true,
    scanned: results.length,
    changed: results.filter((r) => r.changed).length,
    waits: results.filter((r) => r.wait_until).map((r) => ({ id: r.id, wait_until: r.wait_until })),
    errors: results.filter((r) => r.error).length,
    results: results.map((r) => ({ id: r.id.slice(0, 8), changed: r.changed, next: r.next, reason: r.reason, wait_until: r.wait_until ?? null, error: r.error })),
  });
}
