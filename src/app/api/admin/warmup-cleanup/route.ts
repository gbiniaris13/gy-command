// One-shot retroactive cleanup for fake "HOT/WARM lead" contacts that
// were created from Instantly.ai warm-up emails BEFORE the
// f7a14d7 detector landed. Pairs with archive-warmup-backfill (which
// only re-scanned NEUTRAL-labelled mail); this scans HOT/WARM/COLD too
// and removes the matching contact rows in Supabase when their only
// touchpoint is the warmup email.
//
// USAGE
//   GET  /api/admin/warmup-cleanup?secret=<CRON_SECRET>            (dry-run)
//   POST /api/admin/warmup-cleanup  body: { secret, confirm: true } (executes)
//
// SAFETY
// - Dry-run by default — returns the list of suspected fake contacts
//   so George can eyeball before letting it delete anything.
// - Only deletes contacts whose ONLY activity is the auto-created
//   "Inbound email" row from the warmup message itself. Real
//   contacts with calls, replies, deal records, etc. are kept and
//   the warmup-archive logic still runs on the email.
// - Logs every deletion to settings.warmup_cleanup_log_<timestamp>
//   so we have an audit trail if anything looks off.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { detectWarmup } from "@/lib/email-warmup-detector";

export const runtime = "nodejs";
export const maxDuration = 300;

type GmailHeader = { name: string; value: string };

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return "";
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

function extractBody(payload: any): string {
  if (!payload) return "";
  const walk = (part: any): string => {
    if (!part) return "";
    const mt = (part.mimeType || "").toLowerCase();
    if (part.body?.data && (mt === "text/plain" || mt === "text/html")) {
      const raw = Buffer.from(part.body.data, "base64url").toString("utf8");
      if (mt === "text/plain") return raw;
      return raw.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
    }
    if (Array.isArray(part.parts)) {
      const plain = part.parts.find(
        (p: any) => (p.mimeType || "").toLowerCase() === "text/plain",
      );
      if (plain) return walk(plain);
      return part.parts.map(walk).join("\n");
    }
    return "";
  };
  return walk(payload).slice(0, 12000);
}

function emailFromHeader(from: string): string {
  const m = from.match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  return from.trim().toLowerCase();
}

interface SuspectedFake {
  message_id: string;
  email: string;
  subject: string;
  reason: string;
  service: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_activity_count: number;
  delete_safe: boolean; // true if we'd delete in --confirm mode
}

async function findSuspects(): Promise<SuspectedFake[]> {
  const sb = createServiceClient();
  // Scan all the lead-bucket labels — we already have warmup-detected
  // mail correctly archived, so missing those is fine. The interesting
  // set is mail that was wrongly classified as a real lead.
  const query =
    "label:gy-classified/hot OR label:gy-classified/warm OR label:gy-classified/cold OR label:gy-classified/neutral newer_than:30d";
  const listRes = await gmailFetch(
    `/messages?${new URLSearchParams({ q: query, maxResults: "200" })}`,
  );
  if (!listRes.ok) return [];
  const listJson = (await listRes.json()) as { messages?: { id: string }[] };
  const messageIds = listJson.messages ?? [];

  const suspects: SuspectedFake[] = [];

  for (const { id } of messageIds) {
    try {
      const res = await gmailFetch(`/messages/${id}?format=full`);
      if (!res.ok) continue;
      const msg = (await res.json()) as any;
      const headers = msg.payload?.headers ?? [];
      const from = getHeader(headers, "From");
      const subject = getHeader(headers, "Subject");
      const body = extractBody(msg.payload) || msg.snippet || "";
      const headersMap: Record<string, string> = {};
      for (const h of headers) headersMap[h.name.toLowerCase()] = h.value;

      const verdict = detectWarmup({ from, subject, body, headers: headersMap });
      if (!verdict.isWarmup) continue;

      // It's a warmup. Look up the contact + count activities.
      const senderEmail = emailFromHeader(from);
      let contactId: string | null = null;
      let contactName: string | null = null;
      let activityCount = 0;
      if (senderEmail) {
        const { data: contact } = await sb
          .from("contacts")
          .select("id, first_name, last_name")
          .eq("email", senderEmail)
          .maybeSingle();
        if (contact?.id) {
          contactId = contact.id;
          contactName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null;
          const { count } = await sb
            .from("activities")
            .select("id", { count: "exact", head: true })
            .eq("contact_id", contactId);
          activityCount = count ?? 0;
        }
      }

      suspects.push({
        message_id: id,
        email: senderEmail,
        subject: subject.slice(0, 100),
        reason: verdict.reason ?? "unknown",
        service: verdict.service ?? "unknown",
        contact_id: contactId,
        contact_name: contactName,
        contact_activity_count: activityCount,
        delete_safe: contactId !== null && activityCount <= 1,
      });
    } catch (e: any) {
      console.error("[warmup-cleanup] message error", id, e?.message);
    }
  }

  return suspects;
}

async function executeCleanup(suspects: SuspectedFake[]) {
  const sb = createServiceClient();
  const deletedContacts: string[] = [];
  const skippedContacts: { contact_id: string; reason: string }[] = [];

  for (const s of suspects) {
    if (!s.delete_safe || !s.contact_id) {
      if (s.contact_id) {
        skippedContacts.push({
          contact_id: s.contact_id,
          reason: `${s.contact_activity_count} activities — keeping`,
        });
      }
      continue;
    }
    // Delete activities first (FK), then contact.
    await sb.from("activities").delete().eq("contact_id", s.contact_id);
    const { error } = await sb.from("contacts").delete().eq("id", s.contact_id);
    if (error) {
      skippedContacts.push({ contact_id: s.contact_id, reason: error.message });
      continue;
    }
    deletedContacts.push(s.contact_id);
  }

  // Audit log
  await sb.from("settings").upsert({
    key: `warmup_cleanup_log_${Date.now()}`,
    value: JSON.stringify({
      ran_at: new Date().toISOString(),
      total_suspects: suspects.length,
      deleted: deletedContacts,
      skipped: skippedContacts,
    }),
  });

  return { deleted: deletedContacts.length, skipped: skippedContacts };
}

function authOk(secret: string | null) {
  return secret && secret === process.env.CRON_SECRET;
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!authOk(secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const suspects = await findSuspects();
  return NextResponse.json({
    mode: "dry-run",
    total_suspects: suspects.length,
    safe_to_delete: suspects.filter((s) => s.delete_safe).length,
    keep_for_review: suspects.filter((s) => !s.delete_safe).length,
    suspects,
    hint: "POST same endpoint with { secret, confirm: true } to execute",
  });
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!authOk(body.secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      { error: "confirm:true required to execute" },
      { status: 400 },
    );
  }
  const suspects = await findSuspects();
  const result = await executeCleanup(suspects);
  return NextResponse.json({
    mode: "executed",
    total_suspects: suspects.length,
    ...result,
  });
}
