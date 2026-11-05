// GET /api/t/ext/key — hands the GY Track extension its signing key.
// Called by the extension from a Command tab where George is signed in, so
// the key never has to be typed, pasted or stored in a file. It is derived
// from CRON_SECRET (see extKey) and cannot be turned back into it.

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { extKey, trackingBaseUrl } from "@/lib/email-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await requireUser(req);
  if (denied) return denied;
  return NextResponse.json(
    { key: extKey(), base: trackingBaseUrl() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
