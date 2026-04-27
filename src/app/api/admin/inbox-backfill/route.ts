// /api/admin/inbox-backfill — Gmail history sync (chunked + parallel).
//
// Pulls messages in inbox + sent for the requested window, matches the
// counterparty against existing contacts, and writes any missing
// email_inbound / email_sent activities. Heavy lifting done in
// parallel batches; one bulk dedup query per chunk replaces the
// per-message lookup that timed out the previous version.
//
// Run in chunks until ?next is null:
//   /api/admin/inbox-backfill?days=90               (first call)
//   /api/admin/inbox-backfill?days=90&pageToken=... (resume)
//
// The contact-state recompute (inbox_inferred_stage etc.) is NOT done
// here — call /api/cron/inbox-refresh once after the last chunk.
//
// Query params:
//   ?days=90        history window (default 90, max 365)
//   ?limit=400      messages per chunk (default 400, max 800)
//   ?pageToken=…    Gmail nextPageToken from previous response
//   ?dry=1          dry run

import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";
import {
  companyFromEmail,
  isNoiseEmail,
  parseFromHeader,
} from "@/lib/email-signature-parser";

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

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function fetchMessageMeta(id: string): Promise<GmailMessage | null> {
  const res = await gmailFetch(
    `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
  );
  if (!res.ok) return null;
  return (await res.json()) as GmailMessage;
}

async function inBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    const results = await Promise.all(slice.map(fn));
    out.push(...results);
  }
  return out;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const days = Math.min(365, Math.max(1, parseInt(sp.get("days") ?? "90", 10)));
  const limit = Math.min(800, Math.max(50, parseInt(sp.get("limit") ?? "400", 10)));
  const pageToken = sp.get("pageToken") ?? undefined;
  const dry = sp.get("dry") === "1";

  const sb = createServiceClient();

  // 1. Contact email lookup. MUST paginate — Supabase REST hard-caps
  //    a single .select() at 1000 rows even with .not(). We have 1600+
  //    contacts; without paging the lookup map silently dropped every
  //    contact past row 1000 and their messages got logged as
  //    "no_contact_match". This was the root cause of Sandra Braxton
  //    et al. having 7+ Gmail threads but zero activities in DB.
  const contactsByEmail = new Map<string, string>();
  {
    const PAGE = 1000;
    let p = 0;
    while (true) {
      const { data: rows, error } = await sb
        .from("contacts")
        .select("id, email")
        .not("email", "is", null)
        .order("created_at", { ascending: true })
        .range(p * PAGE, (p + 1) * PAGE - 1);
      if (error || !rows || rows.length === 0) break;
      for (const c of rows) {
        if (c.email)
          contactsByEmail.set(
            (c.email as string).toLowerCase(),
            c.id as string,
          );
      }
      if (rows.length < PAGE) break;
      p++;
    }
  }

  // 2. List one chunk of Gmail messages. `in:anywhere` covers inbox,
  //    sent, AND archived threads / category tabs (CATEGORY_UPDATES,
  //    CATEGORY_PERSONAL etc) that `(in:inbox OR in:sent)` was missing.
  //    Sandra Braxton's auto-replies live in CATEGORY_UPDATES with no
  //    INBOX label, so the old query never saw them — `in:anywhere`
  //    fixes that without the per-contact query cost of OR-ing every
  //    contact email.
  const query = `in:anywhere newer_than:${days}d`;
  const params = new URLSearchParams({
    q: query,
    maxResults: String(Math.min(limit, 500)),
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
  const nextPageToken = listJson.nextPageToken ?? null;

  if (ids.length === 0) {
    return NextResponse.json({
      ok: true,
      window_days: days,
      messages_examined: 0,
      next: null,
      hint: "Window empty — run /api/cron/inbox-refresh now to recompute inbox_* fields.",
    });
  }

  // 3. Fetch all metadata in parallel (batches of 20 — Gmail handles
  //    well in this range, finishes a 400-msg chunk in ~30-40s).
  const metas = (await inBatches(ids, 20, fetchMessageMeta)).filter(
    (m): m is GmailMessage => m !== null,
  );

  // 4. Bulk-dedup: one query for ALL existing message_ids in this batch.
  const existingIds = new Set<string>();
  if (metas.length > 0) {
    const allIds = metas.map((m) => m.id);
    const { data: hits } = await sb
      .from("activities")
      .select("metadata")
      .in("metadata->>message_id", allIds)
      .limit(allIds.length);
    for (const h of hits ?? []) {
      const mid = (h.metadata as { message_id?: string } | null)?.message_id;
      if (mid) existingIds.add(mid);
    }
  }

  // 5. Build inserts for unseen messages with a contact match. If no
  //    contact matches, AUTO-CREATE one (per refocus brief Pillar 1
  //    §3: "Contact auto-created/updated for every distinct sender
  //    email"). Skip noise senders (no-reply, billing, bulk lists)
  //    so we don't pollute the CRM with notifications.
  const inserts: Array<Record<string, unknown>> = [];
  const unmatchedCounterparties = new Set<string>();
  let skippedExisting = 0;
  let skippedNoMatch = 0;
  let skippedNoEmail = 0;
  let createdContacts = 0;

  // Look up the default pipeline stage once for new contacts.
  let defaultStageId: string | null = null;
  if (!dry) {
    const { data: stages } = await sb
      .from("pipeline_stages")
      .select("id, name, position")
      .order("position", { ascending: true });
    const newStage = stages?.find((s) => s.name === "New") ?? stages?.[0];
    defaultStageId = (newStage?.id as string | undefined) ?? null;
  }

  for (const msg of metas) {
    if (existingIds.has(msg.id)) {
      skippedExisting++;
      continue;
    }
    const headers = msg.payload?.headers ?? [];
    const from = getHeader(headers, "From");
    const to = getHeader(headers, "To");
    const subject = getHeader(headers, "Subject");
    const isSent = msg.labelIds?.includes("SENT") ?? false;
    const counterparty = isSent ? extractEmail(to) : extractEmail(from);
    if (!counterparty) {
      skippedNoEmail++;
      continue;
    }
    let contactId = contactsByEmail.get(counterparty);

    if (!contactId) {
      // Skip noise/bulk before auto-creating to keep the CRM clean.
      const headersMap: Record<string, string> = {};
      for (const h of headers) headersMap[h.name.toLowerCase()] = h.value;
      const noise = isNoiseEmail({
        from: isSent ? to : from,
        fromEmail: counterparty,
        subject,
        headers: headersMap,
      });
      if (noise.noise) {
        skippedNoMatch++;
        unmatchedCounterparties.add(counterparty);
        continue;
      }

      // Reject Gmail's promotional / social / forum tabs — these are
      // newsletters and notifications, not real conversations. Keep
      // CATEGORY_PERSONAL and CATEGORY_UPDATES (the latter includes
      // legitimate auto-replies like "I'm out of office, returning…"
      // which ARE a useful signal that a real human is on the other
      // end and just needs a follow-up later).
      const labels = msg.labelIds ?? [];
      const isPromo =
        labels.includes("CATEGORY_PROMOTIONS") ||
        labels.includes("CATEGORY_SOCIAL") ||
        labels.includes("CATEGORY_FORUMS");
      if (isPromo) {
        skippedNoMatch++;
        unmatchedCounterparties.add(counterparty);
        continue;
      }

      // Two-track admission for auto-create:
      //   - Personal domains (gmail.com / icloud / yahoo / hotmail / etc)
      //     auto-create on a single message. These are real humans;
      //     newsletters don't ship from gmail.
      //   - Business domains require either ≥2 messages in the chunk
      //     OR a CATEGORY_PERSONAL label (which Gmail uses for genuine
      //     1:1 mail). This keeps single-shot promotional blasts from
      //     pet-shop@somecompany.com out, while still admitting people
      //     George traded one substantive email with.
      const PERSONAL_DOMAINS_LOCAL = new Set([
        "gmail.com", "googlemail.com", "yahoo.com", "ymail.com",
        "hotmail.com", "outlook.com", "live.com", "icloud.com",
        "me.com", "aol.com", "protonmail.com", "proton.me",
        "hey.com", "fastmail.com", "gmx.com", "gmx.de",
      ]);
      const cpDomain = counterparty.split("@")[1] ?? "";
      const isPersonalDomain = PERSONAL_DOMAINS_LOCAL.has(cpDomain);

      if (!isPersonalDomain) {
        const seenAlready = inserts.some(
          (r) =>
            (r.metadata as { thread_id?: string } | null)?.thread_id ===
            msg.threadId,
        );
        const repeatSender =
          seenAlready ||
          metas.filter((m) => {
            const h2 = m.payload?.headers ?? [];
            const f2 = getHeader(h2, "From");
            const t2 = getHeader(h2, "To");
            const sent2 = m.labelIds?.includes("SENT") ?? false;
            const cp2 = sent2 ? extractEmail(t2) : extractEmail(f2);
            return cp2 === counterparty;
          }).length >= 2;
        const looksPersonal = labels.includes("CATEGORY_PERSONAL");
        if (!repeatSender && !looksPersonal) {
          skippedNoMatch++;
          unmatchedCounterparties.add(counterparty);
          continue;
        }
      }

      if (dry) {
        skippedNoMatch++;
        unmatchedCounterparties.add(counterparty);
        continue;
      }
      // Auto-create the contact from the From/To header name.
      const parsedName = parseFromHeader(isSent ? to : from);
      const { first, last } = splitName(parsedName.name ?? "");
      const { data: inserted, error: insErr } = await sb
        .from("contacts")
        .insert({
          first_name: first || null,
          last_name: last || null,
          email: counterparty,
          company: companyFromEmail(counterparty) ?? null,
          source: "outreach_bot",
          pipeline_stage_id: defaultStageId,
          contact_type: "OUTREACH_LEAD",
          last_activity_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insErr || !inserted?.id) {
        skippedNoMatch++;
        unmatchedCounterparties.add(counterparty);
        continue;
      }
      contactId = inserted.id as string;
      contactsByEmail.set(counterparty, contactId);
      createdContacts++;
    }
    const createdAt = msg.internalDate
      ? new Date(parseInt(msg.internalDate, 10)).toISOString()
      : new Date().toISOString();
    inserts.push({
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

  // 6. Single bulk insert.
  let inserted = 0;
  if (!dry && inserts.length > 0) {
    const { error } = await sb.from("activities").insert(inserts);
    if (error) {
      return NextResponse.json(
        { error: error.message, attempted: inserts.length },
        { status: 500 },
      );
    }
    inserted = inserts.length;
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
    contacts_in_map: contactsByEmail.size,
    contacts_created: createdContacts,
    unmatched_sample: Array.from(unmatchedCounterparties).slice(0, 20),
    next: nextPageToken,
    hint: nextPageToken
      ? `More pages remain. Call again with ?pageToken=${nextPageToken}`
      : "Backfill complete. Now hit /api/cron/inbox-refresh to recompute stages.",
  });
}
