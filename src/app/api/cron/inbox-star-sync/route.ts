// /api/cron/inbox-star-sync — pulls Gmail's currently-starred threads
// and reflects them onto contacts.inbox_starred.
//
// Drift-correction job. Live hooks set inbox_starred=true on poll +
// star endpoint, but they don't catch UN-starring or stars George
// applied retroactively to old threads. This nightly pass:
//   1. Lists all is:starred messages in the last 365d
//   2. Maps each to a contact via the From/To header
//   3. Sets inbox_starred=true on those contacts
//   4. Clears inbox_starred=false for contacts no longer in the set
//
// Cheap (~1500 starred messages typical). Runs 04:00 Athens.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";

export const runtime = "nodejs";
export const maxDuration = 300;

type GmailHeader = { name: string; value: string };

function getHeader(headers: GmailHeader[] | undefined, n: string): string {
  if (!headers) return "";
  return headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
}

function extractEmail(value: string): string | null {
  const m = value.match(/<([^>]+)>/);
  const candidate = (m ? m[1] : value).trim().toLowerCase();
  return /.+@.+\..+/.test(candidate) ? candidate : null;
}

export async function GET() {
  const sb = createServiceClient();

  // 1. List all starred messages in the last year.
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < 2000) {
    const params = new URLSearchParams({
      q: "is:starred newer_than:365d",
      maxResults: "200",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gmailFetch(`/messages?${params}`);
    if (!res.ok) break;
    const j = (await res.json()) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    for (const m of j.messages ?? []) ids.push(m.id);
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }

  // 2. Build contact-email lookup (paginated).
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

  // 3. For each starred message, fetch metadata and resolve counterparty
  //    in parallel batches.
  const newlyStarred = new Set<string>();
  const starredThreadIdByContact = new Map<string, string>();
  const BATCH = 20;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const metas = await Promise.all(
      slice.map(async (id) => {
        const r = await gmailFetch(
          `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To`,
        );
        if (!r.ok) return null;
        return (await r.json()) as {
          id: string;
          threadId: string;
          labelIds?: string[];
          payload?: { headers?: GmailHeader[] };
        };
      }),
    );
    for (const m of metas) {
      if (!m) continue;
      const headers = m.payload?.headers ?? [];
      const isSent = m.labelIds?.includes("SENT") ?? false;
      const cp = isSent
        ? extractEmail(getHeader(headers, "To"))
        : extractEmail(getHeader(headers, "From"));
      if (!cp) continue;
      const cid = contactsByEmail.get(cp);
      if (!cid) continue;
      newlyStarred.add(cid);
      if (!starredThreadIdByContact.has(cid))
        starredThreadIdByContact.set(cid, m.threadId);
    }
  }

  // 4. Apply: set inbox_starred=true for newly-starred set, false for
  //    everyone else who's currently true.
  const now = new Date().toISOString();
  let setOn = 0;
  for (const cid of newlyStarred) {
    await sb
      .from("contacts")
      .update({
        inbox_starred: true,
        inbox_starred_at: now,
        inbox_starred_thread_id: starredThreadIdByContact.get(cid) ?? null,
      })
      .eq("id", cid);
    setOn++;
  }

  // Clear stale stars (currently true but no longer in starred set).
  const { data: currentlyStarred } = await sb
    .from("contacts")
    .select("id")
    .eq("inbox_starred", true);
  const stale = (currentlyStarred ?? [])
    .map((c) => c.id as string)
    .filter((id) => !newlyStarred.has(id));
  let clearedOff = 0;
  if (stale.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < stale.length; i += CHUNK) {
      const slice = stale.slice(i, i + CHUNK);
      await sb
        .from("contacts")
        .update({ inbox_starred: false })
        .in("id", slice);
      clearedOff += slice.length;
    }
  }

  return NextResponse.json({
    ok: true,
    starred_messages_seen: ids.length,
    contacts_starred: setOn,
    contacts_cleared: clearedOff,
  });
}
