// GET /api/helm/live — the Helm table's minute poll.
// Returns, per request id, the proposal signals (views, interest, hold,
// dwell) and every tracked email to that client with its state. Read-only
// and light (see lib/helm/live.ts). Every call also teaches the house its
// own address, so George's network is recognised without any setup.

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { helmLive } from "@/lib/helm/live";
import { ipFrom, noteHouseIp } from "@/lib/house-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await requireUser(req);
  if (denied) return denied;
  // Only a signed-in browser teaches the address (a cron bearer is a server).
  if (!req.headers.get("authorization")) {
    await noteHouseIp(ipFrom(req.headers), req.headers.get("user-agent"));
  }
  try {
    const rows = await helmLive();
    return NextResponse.json(
      { ok: true, at: new Date().toISOString(), rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[helm/live]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
