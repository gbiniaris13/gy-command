// /api/admin/commitments-backfill — scan George's recent outbound
// emails and extract commitments retroactively.
//
// Reads sent emails from Gmail directly (not from activities, because
// George sends most outbound through Gmail UI not the cockpit's
// /api/gmail/send hook). For each: matches counterparty to a contact,
// extracts commitments, dedups by source_message_id, inserts.
//
// Time-budgeted with resumable cursor.
//
// Run pattern:
//   /api/admin/commitments-backfill?days=14   first chunk
//   /api/admin/commitments-backfill?pageToken=… resume

import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";
import { extractCommitments } from "@/lib/commitment-extractor";

export const runtime = "nodejs";
export const maxDuration = 300;

type GmailHeader = { name: string; value: string };

function getHeader(h: GmailHeader[] | undefined, n: string): string {
  if (!h) return "";
  return h.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
}

function extractEmail(value: string): string | null {
  const m = value.match(/<([^>]+)>/);
  const candidate = (m ? m[1] : value).trim().toLowerCase();
  return /.+@.+\..+/.test(candidate) ? candidate : null;
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

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const days = Math.min(60, Math.max(1, parseInt(sp.get("days") ?? "14", 10)));
  const pageToken = sp.get("pageToken") ?? undefined;
  const sb = createServiceClient();

  // Contact-email lookup (paginated past 1000-row cap).
  const contactsByEmail = new Map<string, string>();
  {
    const PAGE = 1000;
    let p = 0;
    while (true) {
      const { data: rows } = await sb
        .from("contacts")
        .select("id, email")
        .not("email", "is", null)
        .order("created_at", { ascending: true })
        .range(p * PAGE, (p + 1) * PAGE - 1);
      if (!rows || rows.length === 0) break;
      for (const c of rows)
        if (c.email)
          contactsByEmail.set(
            (c.email as string).toLowerCase(),
            c.id as string,
          );
      if (rows.length < PAGE) break;
      p++;
    }
  }

  // Existing source_message_ids for dedup.
  const existing = new Set<string>();
  {
    const { data } = await sb
      .from("commitments")
      .select("source_message_id")
      .not("source_message_id", "is", null)
      .limit(5000);
    for (const r of data ?? [])
      if (r.source_message_id) existing.add(r.source_message_id as string);
  }

  // List sent emails in window.
  const params = new URLSearchParams({
    q: `in:sent newer_than:${days}d`,
    maxResults: "100",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const listRes = await gmailFetch(`/messages?${params}`);
  if (!listRes.ok) {
    return NextResponse.json(
      { error: "gmail list failed", status: listRes.status },
      { status: 500 },
    );
  }
  const listJson = (await listRes.json()) as {
    messages?: { id: string }[];
    nextPageToken?: string;
  };
  const ids = (listJson.messages ?? []).map((m) => m.id);

  let extracted = 0;
  let skippedExisting = 0;
  let skippedNoMatch = 0;
  let skippedNoCommit = 0;
  let inserted = 0;
  const todayISO = new Date().toISOString().slice(0, 10);

  for (const id of ids) {
    if (existing.has(id)) {
      skippedExisting++;
      continue;
    }
    const res = await gmailFetch(`/messages/${id}?format=full`);
    if (!res.ok) continue;
    const msg = (await res.json()) as {
      id: string;
      threadId: string;
      internalDate?: string;
      payload?: { headers?: GmailHeader[]; parts?: unknown };
    };
    const headers = msg.payload?.headers ?? [];
    const to = getHeader(headers, "To");
    const counterparty = extractEmail(to);
    if (!counterparty) {
      skippedNoMatch++;
      continue;
    }
    const contactId = contactsByEmail.get(counterparty);
    if (!contactId) {
      skippedNoMatch++;
      continue;
    }
    const body = extractBody(msg.payload);
    const commitments = await extractCommitments(body, todayISO);
    extracted++;
    if (commitments.length === 0) {
      skippedNoCommit++;
      continue;
    }
    const sentAt = msg.internalDate
      ? new Date(parseInt(msg.internalDate, 10)).toISOString()
      : new Date().toISOString();
    const rows = commitments.map((c) => ({
      contact_id: contactId,
      thread_id: msg.threadId,
      source_message_id: msg.id,
      source_sent_at: sentAt,
      commitment_text: c.commitment_text,
      commitment_summary: c.commitment_summary,
      deadline_date: c.deadline_date,
      deadline_phrase: c.deadline_phrase,
      confidence: c.confidence,
    }));
    const { error } = await sb.from("commitments").insert(rows);
    if (!error) inserted += rows.length;
  }

  return NextResponse.json({
    ok: true,
    window_days: days,
    messages_examined: ids.length,
    extracted_count: extracted,
    inserted,
    skipped: {
      already_processed: skippedExisting,
      no_contact_match: skippedNoMatch,
      no_commitment_found: skippedNoCommit,
    },
    next: listJson.nextPageToken ?? null,
    hint: listJson.nextPageToken
      ? `More pages: ?days=${days}&pageToken=${listJson.nextPageToken}`
      : "Backfill complete.",
  });
}
