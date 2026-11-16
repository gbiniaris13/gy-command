// /api/helm/wa-outbox — "Send on WhatsApp" from the Helm, delivered by the
// WhatsApp app on George's MacBook (16/11/2026).
//
// George: "θέλω να πατάω το κουμπάκι και να το στέλνει… να βρίσκει τη
// συζήτηση… αν δεν βρει, να παίρνει τον αριθμό, να τον αποθηκεύει, να τον
// ανοίγει μέσα στο WhatsApp και να στέλνει. Το WhatsApp του MacBook."
//
// The Helm cannot reach WhatsApp; the Mac can. So George's click puts ONE
// message in this outbox (settings key wa_outbox), the Mac agent (GY Sync,
// every 20 seconds) opens the chat in the WhatsApp app, sends it, then checks
// WhatsApp's own database that the message really left, and reports back.
// One click = one send: an item is handed out once and never retried by itself.
//
//   GET  (Mac token)            → items waiting to be sent (and marks them "sending")
//   POST (Mac token) {id, status: "sent"|"failed", detail, key, ts}
//        → records the result; a confirmed send is written to the conversation
//          with the same key the sync uses, so it is never duplicated.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getSetting } from "@/lib/google-api";
import { readOutbox, writeOutbox } from "@/lib/helm/followup/outbox";

export const runtime = "nodejs";
export const maxDuration = 30;

async function authed(req: NextRequest): Promise<boolean> {
  const want = await getSetting("conversation_sync_token");
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return !!want && want.length >= 32 && got === want;
}

export async function GET(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const items = await readOutbox();
  const now = Date.now();
  // Only fresh items (a click older than 15 minutes is stale: George will
  // have moved on, and a late message is worse than none).
  const ready = items.filter((i) => i.status === "queued" && now - Date.parse(i.created_at) < 15 * 60000);
  if (ready.length) {
    for (const i of items) if (ready.some((r) => r.id === i.id)) i.status = "sending";
    for (const i of items) if (i.status === "queued" && now - Date.parse(i.created_at) >= 15 * 60000) { i.status = "failed"; i.detail = "Το Mac δεν το πήρε μέσα σε 15 λεπτά (κλειστό ή σε ύπνο). Δεν στάλθηκε."; i.done_at = new Date().toISOString(); }
    await writeOutbox(items);
  }
  return NextResponse.json({ ok: true, items: ready });
}

export async function POST(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; status?: string; detail?: string; key?: string; ts?: string };
  const items = await readOutbox();
  const it = items.find((i) => i.id === b.id);
  if (!it) return NextResponse.json({ error: "not found" }, { status: 404 });
  it.status = b.status === "sent" ? "sent" : "failed";
  it.detail = (b.detail ?? "").toString().slice(0, 300);
  it.done_at = new Date().toISOString();
  await writeOutbox(items);
  if (it.status === "sent" && b.key) {
    const db = createServiceClient();
    const key = `wa:${b.key}`.slice(0, 200);
    const { data: exists } = await db.from("helm_messages").select("id").eq("gmail_message_id", key).maybeSingle();
    if (!exists) {
      await db.from("helm_messages").insert({
        request_id: it.request_id, direction: "outbound", channel: "whatsapp", body: it.text,
        gmail_message_id: key, created_at: b.ts || it.done_at,
      });
    }
  }
  return NextResponse.json({ ok: true });
}
