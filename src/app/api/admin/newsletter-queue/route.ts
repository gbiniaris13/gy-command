// CRM-side proxy for the Wake / Compass intel queue. Forwards to the
// public-site /api/admin/newsletter-queue endpoint with the server-
// side NEWSLETTER_PROXY_SECRET so the browser never sees it.

import { NextRequest, NextResponse } from "next/server";
import {
  listQueueEntries,
  addQueueEntry,
  discardQueueEntry,
  editQueueEntry,
} from "@/lib/newsletter-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const stream = url.searchParams.get("stream") as
      | "wake"
      | "compass"
      | null;
    const status = url.searchParams.get("status") as
      | "pending"
      | "used"
      | "discarded"
      | null;
    if (stream !== "wake" && stream !== "compass") {
      return NextResponse.json(
        { error: "stream must be wake or compass" },
        { status: 400 },
      );
    }
    const r = await listQueueEntries(stream, status ?? undefined);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action ?? "");
    const stream = body?.stream as "wake" | "compass";
    if (stream !== "wake" && stream !== "compass") {
      return NextResponse.json(
        { error: "stream must be wake or compass" },
        { status: 400 },
      );
    }
    if (action === "add") {
      const entry = await addQueueEntry({
        stream,
        text: body.text,
        notes: body.notes,
      });
      return NextResponse.json({ ok: true, entry });
    }
    if (action === "discard") {
      const entry = await discardQueueEntry({ stream, id: body.id });
      return NextResponse.json({ ok: true, entry });
    }
    if (action === "edit") {
      const entry = await editQueueEntry({
        stream,
        id: body.id,
        text: body.text,
        notes: body.notes,
      });
      return NextResponse.json({ ok: true, entry });
    }
    return NextResponse.json(
      { error: `unknown action: ${action}` },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "queue op failed" },
      { status: 500 },
    );
  }
}
