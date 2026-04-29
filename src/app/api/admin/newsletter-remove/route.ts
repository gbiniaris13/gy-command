import { NextRequest, NextResponse } from "next/server";
import { removeSubscriber } from "@/lib/newsletter-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "valid email required" }, { status: 400 });
    }
    const stream = body.stream ? String(body.stream).toLowerCase() : undefined;
    const result = await removeSubscriber({
      email,
      stream: (stream as any) || undefined,
      suppress: body.suppress === true,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
