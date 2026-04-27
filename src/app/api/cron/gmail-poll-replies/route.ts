// Gmail auto-classifier + inbox-CRM cron — every 5 minutes.
//
// The inbox IS the CRM. Every real inbound email either:
//   (a) matches an existing contact → activity logged + stage updated
//       on HOT/WARM per /api/gmail/classify, OR
//   (b) doesn't match → a NEW contact is created on the fly with data
//       mined from the signature block (name, title, company, phone,
//       LinkedIn) + domain-derived company fallback, then classified
//       and stage-set identically.
//
// Pipeline behavior (Option B agreed 23/04):
//   HOT      → contact stage = Hot, Telegram 🔴 alert
//   WARM     → stage = Warm, Telegram 🟡 alert
//   COLD     → activity note "replied: declined — <reason>" (no stage move)
//   NEUTRAL  → silent; follow-up sequence continues
//
// Noise filter (see email-signature-parser.ts):
//   - no-reply / notifications / billing / newsletters → skipped
//   - bulk headers (List-Unsubscribe, Precedence: bulk) → skipped
//   - mailer-daemon, bounces → skipped
//
// Every real email also gets an `activities` row of type `email_inbound`
// linked to the contact — full thread history visible on the contact
// detail page.

import { NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import {
  companyFromEmail,
  isNoiseEmail,
  mergeContactFields,
  parseFromHeader,
  parseSignature,
} from "@/lib/email-signature-parser";
import { detectWarmup } from "@/lib/email-warmup-detector";
import { refreshContactInbox } from "@/lib/inbox-analyzer";
import { tagOneContact } from "@/lib/pillar2-tagger";

export const runtime = "nodejs";
export const maxDuration = 300;

type GmailHeader = { name: string; value: string };
type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    parts?: any[];
    body?: { data?: string };
    mimeType?: string;
  };
};

const LABEL_NAMES = {
  classified: "gy-classified",
  hot: "gy-classified/hot",
  warm: "gy-classified/warm",
  cold: "gy-classified/cold",
  neutral: "gy-classified/neutral",
  noise: "gy-classified/noise",
  warmup: "gy-warmup",
} as const;

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return "";
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

function extractBody(payload: GmailMessage["payload"]): string {
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

async function ensureLabel(
  name: string,
  cache: Map<string, string>,
): Promise<string | null> {
  if (cache.has(name)) return cache.get(name)!;
  const listRes = await gmailFetch("/labels");
  if (!listRes.ok) return null;
  const listJson = (await listRes.json()) as { labels?: { id: string; name: string }[] };
  const existing = (listJson.labels ?? []).find((l) => l.name === name);
  if (existing) {
    cache.set(name, existing.id);
    return existing.id;
  }
  const createRes = await gmailFetch("/labels", {
    method: "POST",
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  if (!createRes.ok) return null;
  const created = (await createRes.json()) as { id: string };
  cache.set(name, created.id);
  return created.id;
}

async function applyLabels(messageId: string, labelIds: string[]): Promise<void> {
  if (labelIds.length === 0) return;
  await gmailFetch(`/messages/${messageId}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds: labelIds }),
  });
}

// Archive = remove INBOX label. Email disappears from inbox view but
// stays searchable under its applied labels (gy-warmup/*).
async function archiveMessage(messageId: string, addLabelIds: string[] = []): Promise<void> {
  await gmailFetch(`/messages/${messageId}/modify`, {
    method: "POST",
    body: JSON.stringify({
      addLabelIds,
      removeLabelIds: ["INBOX", "UNREAD"],
    }),
  });
}

// Split a name string into first/last, being forgiving about middle
// names and suffixes.
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// Upsert a contact from an inbound email. Returns the contact id, plus
// whether it was newly created (for Telegram messaging).
async function upsertContactFromEmail(args: {
  senderEmail: string;
  fromName: string | null;
  signature: ReturnType<typeof parseSignature>;
}): Promise<{ id: string; created: boolean } | null> {
  const sb = createServiceClient();

  // Pre-compute proposed fields from the email + signature.
  const sigName = args.signature.name;
  const pickedName = sigName || args.fromName || "";
  const { first, last } = splitName(pickedName);
  const companyFromSig = args.signature.company;
  const companyFromDomain = companyFromEmail(args.senderEmail);

  const { data: existing } = await sb
    .from("contacts")
    .select("*")
    .ilike("email", args.senderEmail)
    .maybeSingle();

  if (existing) {
    const proposed: Record<string, any> = {
      first_name: first || null,
      last_name: last || null,
      company: companyFromSig || companyFromDomain || null,
      phone: args.signature.phone,
      linkedin_url: args.signature.linkedinUrl,
    };
    const updates = mergeContactFields(existing as any, proposed);
    if (Object.keys(updates).length > 0) {
      updates.last_activity_at = new Date().toISOString();
      await sb.from("contacts").update(updates).eq("id", existing.id);
    }
    return { id: existing.id, created: false };
  }

  // Find default pipeline stage "New" or fall back to the lowest-position stage.
  const { data: stages } = await sb
    .from("pipeline_stages")
    .select("id, name, position")
    .order("position", { ascending: true });
  const newStage =
    stages?.find((s: any) => s.name === "New") ?? stages?.[0];

  const insertBody: Record<string, any> = {
    first_name: first || null,
    last_name: last || null,
    email: args.senderEmail,
    phone: args.signature.phone,
    company: companyFromSig || companyFromDomain || null,
    linkedin_url: args.signature.linkedinUrl,
    source: "outreach_bot", // table constraint accepts: outreach_bot | referral
    pipeline_stage_id: newStage?.id ?? null,
    contact_type: "OUTREACH_LEAD",
    notes: args.signature.title
      ? `Title (from signature): ${args.signature.title}`
      : null,
    last_activity_at: new Date().toISOString(),
  };
  const { data: inserted, error } = await sb
    .from("contacts")
    .insert(insertBody)
    .select("id")
    .single();
  if (error) {
    console.error("[gmail-poll] contact insert failed:", error.message);
    return null;
  }
  return { id: inserted.id, created: true };
}

async function logInboundActivity(args: {
  contactId: string;
  messageId: string;
  threadId: string;
  subject: string;
  snippet: string;
  classification: string;
  reason?: string;
}): Promise<void> {
  const sb = createServiceClient();
  const type =
    args.classification === "COLD"
      ? "email_reply_cold"
      : args.classification === "HOT" || args.classification === "WARM"
        ? "email_reply_hot_or_warm"
        : "email_inbound";
  await sb.from("activities").insert({
    contact_id: args.contactId,
    type,
    description:
      args.classification === "COLD"
        ? `Replied: declined — ${args.reason ?? ""}`.slice(0, 500)
        : `Inbound email — ${args.subject}`.slice(0, 500),
    metadata: {
      message_id: args.messageId,
      thread_id: args.threadId,
      subject: args.subject,
      snippet: args.snippet.slice(0, 300),
      classification: args.classification,
    },
  });
}

async function classifyViaApi(payload: {
  messageId: string;
  from: string;
  subject: string;
  body: string;
  headers: Record<string, string>;
}): Promise<{
  classification: "HOT" | "WARM" | "COLD" | "NEUTRAL";
  reason?: string;
  suggested_response?: string;
} | null> {
  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || "https://gy-command.vercel.app";
  const res = await fetch(`${origin}/api/gmail/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("[gmail-poll] classify call failed:", res.status, await res.text());
    return null;
  }
  return res.json();
}

async function processMessage(
  messageId: string,
  labelCache: Map<string, string>,
): Promise<{ ok: boolean; classification?: string; created?: boolean; reason?: string }> {
  const res = await gmailFetch(`/messages/${messageId}?format=full`);
  if (!res.ok) return { ok: false, reason: `fetch ${res.status}` };
  const msg = (await res.json()) as GmailMessage;

  const headers = msg.payload?.headers ?? [];
  const from = getHeader(headers, "From");
  const subject = getHeader(headers, "Subject");
  const body = extractBody(msg.payload) || msg.snippet || "";

  const headersMap: Record<string, string> = {};
  for (const h of headers) headersMap[h.name.toLowerCase()] = h.value;

  const { name: fromName, email: fromEmail } = parseFromHeader(from);
  if (!fromEmail) {
    // Can't parse sender — label as neutral and move on
    const n = await ensureLabel(LABEL_NAMES.classified, labelCache);
    const b = await ensureLabel(LABEL_NAMES.neutral, labelCache);
    await applyLabels(messageId, [n, b].filter(Boolean) as string[]);
    return { ok: true, reason: "no_sender_email" };
  }

  // ── WARMUP GATE ────────────────────────────────────────────────
  // Run this BEFORE the noise gate + BEFORE any CRM work. Warmup
  // emails are the #1 source of inbox pollution — they must never
  // reach the CRM, never create contacts, never log activities,
  // and never sit in the inbox. We:
  //   1. detect via service headers / message-id domain / template body
  //   2. apply gy-warmup label (plus gy-classified for dedup)
  //   3. remove INBOX + UNREAD labels → vanishes from primary view
  //      but stays searchable under 'label:gy-warmup'
  // Also catches warmup mail forwarded from eleanna@ since the
  // detector inspects the original headers + body content.
  const warmup = detectWarmup({ from, subject, body, headers: headersMap });
  if (warmup.isWarmup) {
    const classifiedId = await ensureLabel(LABEL_NAMES.classified, labelCache);
    const warmupId = await ensureLabel(LABEL_NAMES.warmup, labelCache);
    await archiveMessage(
      messageId,
      [classifiedId, warmupId].filter(Boolean) as string[],
    );
    return { ok: true, classification: "WARMUP", reason: warmup.reason };
  }

  // Noise gate: skip notifications/bulk/transactional before touching CRM
  const noise = isNoiseEmail({
    from,
    fromEmail,
    subject,
    headers: headersMap,
  });
  if (noise.noise) {
    const c = await ensureLabel(LABEL_NAMES.classified, labelCache);
    const n = await ensureLabel(LABEL_NAMES.noise, labelCache);
    // Noise emails (billing/notifications) also archived — no reason
    // to keep them in the main inbox once we've seen them.
    await archiveMessage(messageId, [c, n].filter(Boolean) as string[]);
    return { ok: true, classification: "NOISE", reason: noise.reason };
  }

  // Parse signature + upsert contact FIRST so the classify route has a
  // matched contact to update, and so HOT alerts include the new name.
  const signature = parseSignature(body);
  const contact = await upsertContactFromEmail({
    senderEmail: fromEmail,
    fromName,
    signature,
  });

  // Classify
  const result = await classifyViaApi({
    messageId,
    from,
    subject,
    body,
    headers: headersMap,
  });
  if (!result) {
    // Classify API failed — label the message as neutral so it doesn't
    // re-enter the poll every 5 minutes forever. Contact (if created) is
    // still in the CRM; re-classification can be done manually if needed.
    const cid = await ensureLabel(LABEL_NAMES.classified, labelCache);
    const nid = await ensureLabel(LABEL_NAMES.neutral, labelCache);
    await applyLabels(messageId, [cid, nid].filter(Boolean) as string[]);
    return { ok: false, reason: "classify api failed — labelled neutral" };
  }

  // Log inbound activity on every real email (not just HOT/WARM).
  if (contact?.id) {
    await logInboundActivity({
      contactId: contact.id,
      messageId,
      threadId: msg.threadId,
      subject,
      snippet: msg.snippet ?? body.slice(0, 300),
      classification: result.classification,
      reason: result.reason,
    });
    // Pillar 1 — refresh inbox_* fields immediately so the cockpit
    // surfaces this thread on the next read without waiting for the
    // nightly inbox-refresh cron.
    try {
      const sb = createServiceClient();
      await refreshContactInbox(sb, contact.id);
      // Pillar 1.5 — propagate Gmail STAR signal. If the inbound
      // carries STARRED label, mark the contact starred (top-of-
      // cockpit boost). Star-removal is reconciled by the nightly
      // inbox-star-sync cron.
      if (msg.labelIds?.includes("STARRED")) {
        await sb
          .from("contacts")
          .update({
            inbox_starred: true,
            inbox_starred_at: new Date().toISOString(),
            inbox_starred_thread_id: msg.threadId,
          })
          .eq("id", contact.id);
      }
    } catch (err) {
      console.error("[gmail-poll] inbox refresh failed:", err);
    }
  }

  // Pillar 2 — auto-tag NEW contacts within 5 min of first email (per
  // refocus brief acceptance criteria). Skip already-known contacts;
  // they get re-tagged on the next force-tag pass.
  if (contact?.created && contact.id) {
    try {
      const sb = createServiceClient();
      await tagOneContact(sb, contact.id);
    } catch (err) {
      console.error("[gmail-poll] auto-tag failed:", err);
    }
  }

  // Extra Telegram alert on newly created contacts from HOT/WARM replies
  // — the classify route already fires a per-email alert but we add a
  // "new contact created" footer if this was previously unknown.
  if (contact?.created && (result.classification === "HOT" || result.classification === "WARM")) {
    await sendTelegram(
      `🆕 <b>New contact created from inbound email</b>\n` +
        `Name: ${[signature.name, fromName].filter(Boolean)[0] ?? fromEmail}\n` +
        `Company: ${signature.company ?? companyFromEmail(fromEmail) ?? "—"}\n` +
        `Email: ${fromEmail}\n` +
        `Classification: ${result.classification}`,
    ).catch(() => {});
  }

  // Apply dedup labels
  const classifiedId = await ensureLabel(LABEL_NAMES.classified, labelCache);
  const bucketName =
    result.classification === "HOT"
      ? LABEL_NAMES.hot
      : result.classification === "WARM"
        ? LABEL_NAMES.warm
        : result.classification === "COLD"
          ? LABEL_NAMES.cold
          : LABEL_NAMES.neutral;
  const bucketId = await ensureLabel(bucketName, labelCache);
  await applyLabels(
    messageId,
    [classifiedId, bucketId].filter(Boolean) as string[],
  );

  return { ok: true, classification: result.classification, created: contact?.created };
}

export async function GET() {
  try {
    // Inbox replies from the last 2 days that haven't been classified yet.
    // Excluding our own outgoing + already-labeled ones.
    const query = [
      "in:inbox",
      "-from:me",
      "-label:gy-classified",
      "newer_than:2d",
    ].join(" ");

    const listRes = await gmailFetch(
      `/messages?${new URLSearchParams({ q: query, maxResults: "40" })}`,
    );
    if (!listRes.ok) {
      const text = await listRes.text();
      return NextResponse.json(
        { error: "gmail list failed", status: listRes.status, detail: text.slice(0, 400) },
        { status: 500 },
      );
    }
    const listJson = (await listRes.json()) as { messages?: { id: string }[] };
    const messageIds = listJson.messages ?? [];

    if (messageIds.length === 0) {
      return NextResponse.json({ skipped: "no_new_replies" });
    }

    const labelCache = new Map<string, string>();
    const results: any[] = [];
    for (const { id } of messageIds) {
      try {
        const r = await processMessage(id, labelCache);
        results.push({ id, ...r });
      } catch (e: any) {
        results.push({ id, ok: false, reason: e.message ?? "exception" });
      }
    }

    const summary = results.reduce(
      (acc, r) => {
        if (!r.ok) acc.failed = (acc.failed ?? 0) + 1;
        else {
          const key = (r.classification ?? "unknown").toLowerCase();
          acc[key] = (acc[key] ?? 0) + 1;
          if (r.created) acc.new_contacts = (acc.new_contacts ?? 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>,
    );

    return NextResponse.json({ processed: results.length, summary, results });
  } catch (e: any) {
    await sendTelegram(
      `⚠️ <b>Gmail poll-replies cron crashed</b>\n<code>${(e.message ?? "unknown").slice(0, 400)}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 });
  }
}
