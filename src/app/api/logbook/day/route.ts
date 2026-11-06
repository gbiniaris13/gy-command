// THE LOGBOOK: the full record of one day, for the page (the dashboard
// asks for it when George taps a day on the chart).

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { readDay } from "@/lib/logbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Local layout preview only, the same test the middleware makes for
  // /dashboard: the host must be localhost AND the flag set. Production
  // hostnames never match and the flag is never set there.
  const localPreview = url.hostname === "localhost" && process.env.DEV_LAYOUT_PREVIEW === "1";
  if (!localPreview) {
    const denied = await requireUser(req);
    if (denied) return denied;
  }
  const date = url.searchParams.get("date") || "";
  const day = await readDay(date);
  if (!day) return NextResponse.json({ ok: false, error: "no record for that day" }, { status: 404 });
  return NextResponse.json({ ok: true, day }, { headers: { "cache-control": "no-store" } });
}
