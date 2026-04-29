// CRM-side composer proxy. Forwards to the public-site
// /api/admin/newsletter-compose endpoint with the server-side
// NEWSLETTER_PROXY_SECRET so the browser never sees the secret.

import { NextRequest, NextResponse } from "next/server";
import { compose } from "@/lib/newsletter-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.content_type) {
      return NextResponse.json(
        { error: "content_type required" },
        { status: 400 },
      );
    }
    if (!Array.isArray(body?.audience) || body.audience.length === 0) {
      return NextResponse.json(
        { error: "audience[] required" },
        { status: 400 },
      );
    }
    const result = await compose(body);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
