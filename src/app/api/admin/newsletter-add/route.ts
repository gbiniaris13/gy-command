// Browser-facing proxy: dashboard page POSTs here, this server route
// then calls the upstream george-yachts /api/admin/newsletter-add-subscribers
// using the server-side NEWSLETTER_PROXY_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { addSubscribers } from "@/lib/newsletter-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const stream = String(body.stream || "bridge").toLowerCase();
    if (!["bridge", "wake", "compass", "greece"].includes(stream)) {
      return NextResponse.json({ error: "bad stream" }, { status: 400 });
    }
    const emails = Array.isArray(body.emails) ? body.emails : [];
    if (emails.length === 0) {
      return NextResponse.json({ error: "emails[] required" }, { status: 400 });
    }
    const result = await addSubscribers({
      stream: stream as any,
      emails,
      source: body.source ?? "crm_admin",
      send_welcome: !!body.send_welcome,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
