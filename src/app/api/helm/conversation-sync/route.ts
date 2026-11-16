// /api/helm/conversation-sync — the Mac → Helm bridge for WhatsApp and
// iMessage/SMS (16/11/2026).
//
// George, after a near miss: "θα πρέπει να τσεκάρει από παντού τι επικοινωνία
// έχω κάνει με τον πελάτη". WhatsApp and Messages live only on his Mac, so a
// small job there (GY Sync.app, every 10 minutes while the Mac is awake) reads
// them locally and sends ONLY the messages with Helm clients' numbers here.
//
//   GET  → the phone numbers to look for (request id, last 9 digits, since)
//   POST → { messages: [{ request_id, ts, from_me, text, channel, key }] }
//          stored as helm_messages (whatsapp / imessage), idempotent by key.
//
// Auth: Bearer token = settings.conversation_sync_token (set once from the Mac
// side). No session, no cron secret on the Mac. Read + insert only; it never
// sends anything to anyone.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getSetting, setSetting } from "@/lib/google-api";
import { autoReplanMany } from "@/lib/helm/followup/replan";

export const runtime = "nodejs";
export const maxDuration = 300; // the re-plan of the requests that just got new messages runs here too

async function authed(req: NextRequest): Promise<boolean> {
  const want = await getSetting("conversation_sync_token");
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return !!want && want.length >= 32 && got === want;
}

const digits9 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-9);

export async function GET(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createServiceClient();
  const since = new Date(Date.now() - 540 * 86400000).toISOString();
  const { data, error } = await db
    .from("helm_requests")
    .select("id, client_whatsapp, created_at, status")
    .gte("created_at", since)
    .not("client_whatsapp", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const targets = (data ?? [])
    // From a month before the request: a WhatsApp chat often starts before
    // the request is entered in the Helm.
    .map((r) => ({ id: r.id as string, phone9: digits9(r.client_whatsapp as string), since: new Date(Date.parse(r.created_at as string) - 30 * 86400000).toISOString(), status: r.status as string }))
    .filter((t) => t.phone9.length === 9);
  return NextResponse.json({ ok: true, targets });
}

type Msg = { request_id: string; ts: string; from_me: boolean; text: string; channel: "whatsapp" | "imessage"; key: string };

export async function POST(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { messages?: Msg[]; sources?: Record<string, unknown> };
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && typeof m.request_id === "string" && typeof m.key === "string" && typeof m.ts === "string" && (m.text ?? "").trim())
    .slice(0, 2000);
  const db = createServiceClient();
  let inserted = 0;
  // Idempotency: the message's own id rides in gmail_message_id ("wa:…" /
  // "im:…"), the column helm_messages already uses to skip duplicates.
  const keys = msgs.map((m) => `${m.channel === "imessage" ? "im" : "wa"}:${m.key}`.slice(0, 200));
  const existing = new Set<string>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await db.from("helm_messages").select("gmail_message_id").in("gmail_message_id", keys.slice(i, i + 200));
    (data ?? []).forEach((d) => existing.add(d.gmail_message_id as string));
  }
  const rows = msgs
    .map((m, i) => ({ m, key: keys[i] }))
    .filter(({ key }) => !existing.has(key))
    .map(({ m, key }) => ({
      request_id: m.request_id,
      direction: m.from_me ? "outbound" : "inbound",
      // helm_messages.channel allows email|whatsapp|note; iMessage/SMS is kept
      // as a note with a clear prefix so the timeline still shows who said what.
      channel: m.channel === "whatsapp" ? "whatsapp" : "note",
      body: (m.channel === "imessage" ? `[iMessage/SMS ${m.from_me ? "George → client" : "client → George"}] ` : "") + m.text.slice(0, 4000),
      gmail_message_id: key,
      created_at: m.ts,
    }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("helm_messages").insert(rows.slice(i, i + 200));
    if (error) return NextResponse.json({ error: error.message, inserted }, { status: 500 });
    inserted += Math.min(200, rows.length - i);
  }
  await setSetting("conversation_sync_last", JSON.stringify({ at: new Date().toISOString(), received: msgs.length, inserted, sources: body.sources ?? null }));
  // New words on WhatsApp/iMessage → re-time those clients' plans now, not
  // at the next hourly sweep (George talks to a client at night; tomorrow's
  // follow-up must already have moved).
  const touched = Array.from(new Set(rows.map((r) => r.request_id)));
  let replanned = 0;
  if (touched.length) {
    try { replanned = (await autoReplanMany(touched, { concurrency: 4, deadlineMs: 200000 })).filter((r) => r.changed).length; } catch { /* the hourly sweep will catch up */ }
  }
  return NextResponse.json({ ok: true, received: msgs.length, inserted, replanned });
}
