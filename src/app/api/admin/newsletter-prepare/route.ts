import { NextRequest, NextResponse } from "next/server";
import { prepareIssue1 } from "@/lib/newsletter-proxy";
import { requireUser } from "@/lib/require-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireUser(req);
  if (denied) return denied;
  try {
    const body = await req.json().catch(() => ({}));
    const result = await prepareIssue1(body?.reset === true);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
