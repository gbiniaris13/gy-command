// CRM-side proxy for the Composer dropdown options
// (yachts + blog posts) used by the Composer UI tab.

import { NextResponse } from "next/server";
import { getComposerOptions } from "@/lib/newsletter-proxy";
import { requireUser } from "@/lib/require-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireUser(request);
  if (denied) return denied;
  try {
    const result = await getComposerOptions();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
