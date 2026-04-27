// /api/admin/inbox-create-contact — manual contact create + Gmail import.
//
// For benchmark contacts the auto-create filter missed (e.g. Iordanis,
// only 1 message in CATEGORY_PROMOTIONS spread across multiple chunks).
// Creates the contact, then imports their last 90 days of Gmail
// activity, then refreshes their inbox state.
//
// Usage:
//   /api/admin/inbox-create-contact?email=arzoglou.iordanis@gmail.com&first=Iordanis&last=Arzoglou

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { companyFromEmail } from "@/lib/email-signature-parser";
import { refreshContactInbox } from "@/lib/inbox-analyzer";

export const runtime = "nodejs";
export const maxDuration = 120;

type GmailHeader = { name: string; value: string };

function getHeader(headers: GmailHeader[] | undefined, n: string): string {
  if (!headers) return "";
  return (
    headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? ""
  );
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get("email")?.toLowerCase();
  const first = sp.get("first") ?? null;
  const last = sp.get("last") ?? null;
  if (!email) {
    return NextResponse.json(
      { error: "pass ?email=...&first=...&last=..." },
      { status: 400 },
    );
  }

  const sb = createServiceClient();

  // 1. Create or fetch the contact.
  let contactId: string;
  {
    const { data: existing } = await sb
      .from("contacts")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (existing) {
      contactId = existing.id as string;
    } else {
      const { data: stages } = await sb
        .from("pipeline_stages")
        .select("id, name, position")
        .order("position", { ascending: true });
      const newStage = stages?.find((s) => s.name === "New") ?? stages?.[0];
      const { data: inserted, error: insErr } = await sb
        .from("contacts")
        .insert({
          first_name: first,
          last_name: last,
          email,
          company: companyFromEmail(email) ?? null,
          source: "outreach_bot",
          pipeline_stage_id: (newStage?.id as string | undefined) ?? null,
          contact_type: "OUTREACH_LEAD",
          last_activity_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insErr || !inserted) {
        return NextResponse.json(
          { error: insErr?.message ?? "insert failed" },
          { status: 500 },
        );
      }
      contactId = inserted.id as string;
    }
  }

  // 2. Probe Gmail for their messages in last 90 days.
  const probe = await gmailFetch(
    `/messages?${new URLSearchParams({
      q: `(from:${email} OR to:${email}) newer_than:90d`,
      maxResults: "30",
    })}`,
  );
  if (!probe.ok) {
    return NextResponse.json({ ok: true, contact_id: contactId, gmail: "probe failed" });
  }
  const probeJson = (await probe.json()) as { messages?: { id: string }[] };
  const ids = probeJson.messages ?? [];

  // 3. For each, dedup against existing activities, then insert.
  let inserted = 0;
  let skipped = 0;
  for (const m of ids) {
    const { data: existing } = await sb
      .from("activities")
      .select("id")
      .eq("contact_id", contactId)
      .eq("metadata->>message_id", m.id)
      .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }
    const meta = await gmailFetch(
      `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    if (!meta.ok) continue;
    const mj = (await meta.json()) as {
      threadId: string;
      internalDate?: string;
      snippet?: string;
      labelIds?: string[];
      payload?: { headers?: GmailHeader[] };
    };
    const headers = mj.payload?.headers ?? [];
    const subject = getHeader(headers, "Subject");
    const isSent = mj.labelIds?.includes("SENT") ?? false;
    const createdAt = mj.internalDate
      ? new Date(parseInt(mj.internalDate, 10)).toISOString()
      : new Date().toISOString();
    await sb.from("activities").insert({
      contact_id: contactId,
      type: isSent ? "email_sent" : "email_inbound",
      description: `${isSent ? "Sent" : "Inbound"} — ${subject}`.slice(0, 500),
      metadata: {
        message_id: m.id,
        thread_id: mj.threadId,
        subject,
        snippet: (mj.snippet ?? "").slice(0, 300),
        direction: isSent ? "outbound" : "inbound",
        backfilled: true,
        manual_create: true,
      },
      created_at: createdAt,
    });
    inserted++;
  }

  // 4. Recompute inbox state for this contact.
  const state = await refreshContactInbox(sb, contactId);

  return NextResponse.json({
    ok: true,
    contact_id: contactId,
    gmail_messages_found: ids.length,
    activities_inserted: inserted,
    activities_skipped: skipped,
    inbox_state: state,
  });
}
