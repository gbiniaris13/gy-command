// /api/admin/inbox-backfill — one-shot Gmail history sync.
//
// Pulls every message in inbox + sent for the last 90 days, matches
// the From / To address against existing contacts, and writes any
// missing email_inbound / email_sent activities. Then runs the
// inbox-analyzer over every contact to populate inbox_* columns.
//
// Run manually after deploying the Inbox Brain pillar so the cockpit
// has a full conversation history to read from. Idempotent — uses the
// activities.metadata->>message_id index check to avoid duplicates.
//
// Query params:
//   ?days=90        history window (default 90, max 365)
//   ?limit=2000     max messages to process (default 1000)
//   ?dry=1          dry run — don't write activities

import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";
import { refreshAllContactsInbox } from "@/lib/inbox-analyzer";

export const runtime = "nodejs";
export const maxDuration = 300;

type GmailHeader = { name: string; value: string };
type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
};

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return "";
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractEmail(value: string): string | null {
  const m = value.match(/<([^>]+)>/);
  const candidate = (m ? m[1] : value).trim().toLowerCase();
  return /.+@.+\..+/.test(candidate) ? candidate : null;
}

async function listMessages(query: string, max: number): Promise<{ id: string }[]> {
  const out: { id: string }[] = [];
  let pageToken: string | undefined;
  while (out.length < max) {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gmailFetch(`/messages?${params}`);
    if (!res.ok) break;
    const json = (await res.json()) as { messages?: { id: string }[]; nextPageToken?: string };
    for (const m of json.messages ?? []) {
      out.push(m);
      if (out.length >= max) break;
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}

async function fetchMessage(id: string): Promise<GmailMessage | null> {
  const res = await gmailFetch(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
  if (!res.ok) return null;
  return (await res.json()) as GmailMessage;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const days = Math.min(365, Math.max(1, parseInt(sp.get("days") ?? "90", 10)));
  const limit = Math.min(5000, Math.max(50, parseInt(sp.get("limit") ?? "1000", 10)));
  const dry = sp.get("dry") === "1";

  const sb = createServiceClient();

  // 1. Build a contact-email lookup table once.
  const { data: contactRows } = await sb
    .from("contacts")
    .select("id, email")
    .not("email", "is", null);
  const contactsByEmail = new Map<string, string>();
  for (const c of contactRows ?? []) {
    if (c.email) contactsByEmail.set((c.email as string).toLowerCase(), c.id as string);
  }

  // 2. List candidate Gmail messages (inbox + sent, time-windowed).
  const query = `(in:inbox OR in:sent) newer_than:${days}d`;
  const ids = await listMessages(query, limit);

  // 3. For each message, fetch metadata and reconcile with activities.
  let inserted = 0;
  let skippedExisting = 0;
  let skippedNoMatch = 0;
  let skippedNoEmail = 0;
  const sample: Array<{
    contact_id: string;
    counterparty: string;
    subject: string;
    sent: boolean;
  }> = [];

  for (const { id } of ids) {
    const msg = await fetchMessage(id);
    if (!msg) continue;
    const headers = msg.payload?.headers ?? [];
    const from = getHeader(headers, "From");
    const to = getHeader(headers, "To");
    const subject = getHeader(headers, "Subject");
    const isSent = msg.labelIds?.includes("SENT") ?? false;

    // Pick the counterparty email — From if it's an inbound, To if sent.
    const counterparty = isSent ? extractEmail(to) : extractEmail(from);
    if (!counterparty) {
      skippedNoEmail++;
      continue;
    }
    const contactId = contactsByEmail.get(counterparty);
    if (!contactId) {
      skippedNoMatch++;
      continue;
    }

    // Check if we've already logged this message.
    const { data: existing } = await sb
      .from("activities")
      .select("id")
      .eq("contact_id", contactId)
      .eq("metadata->>message_id", msg.id)
      .maybeSingle();
    if (existing) {
      skippedExisting++;
      continue;
    }

    if (!dry) {
      const createdAt = msg.internalDate
        ? new Date(parseInt(msg.internalDate, 10)).toISOString()
        : new Date().toISOString();
      await sb.from("activities").insert({
        contact_id: contactId,
        type: isSent ? "email_sent" : "email_inbound",
        description: `${isSent ? "Sent" : "Inbound"} — ${subject}`.slice(0, 500),
        metadata: {
          message_id: msg.id,
          thread_id: msg.threadId,
          subject,
          snippet: (msg.snippet ?? "").slice(0, 300),
          direction: isSent ? "outbound" : "inbound",
          backfilled: true,
        },
        created_at: createdAt,
      });
    }
    inserted++;
    if (sample.length < 10) {
      sample.push({ contact_id: contactId, counterparty, subject, sent: isSent });
    }
  }

  // 4. Recompute inbox_* fields for every contact.
  let analysis: { processed: number; by_stage: Record<string, number> } | null = null;
  if (!dry) {
    analysis = await refreshAllContactsInbox(sb);
  }

  return NextResponse.json({
    ok: true,
    dry,
    window_days: days,
    messages_examined: ids.length,
    inserted,
    skipped: {
      already_logged: skippedExisting,
      no_contact_match: skippedNoMatch,
      no_sender_email: skippedNoEmail,
    },
    sample,
    analysis,
  });
}
