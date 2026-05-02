// /api/command-center/snapshot — single read endpoint that powers the
// Tron-style /dashboard/command-center page. Reuses the cached cockpit
// briefing when available; augments with cheap live counts.
//
// Newsletter is intentionally NOT included here — that surface lives at
// /dashboard/newsletter and stays untouched.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  buildCommandCenterSnapshot,
  emptySnapshot,
} from "@/lib/command-center-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sb = createServiceClient();
    const snapshot = await buildCommandCenterSnapshot(sb);
    return NextResponse.json(snapshot);
  } catch (e: any) {
    console.error("[command-center/snapshot] failed:", e);
    return NextResponse.json(
      { ...emptySnapshot(), error: e?.message ?? "snapshot build failed" },
      { status: 200 }, // never 500 the dashboard — render empty state
    );
  }
}
