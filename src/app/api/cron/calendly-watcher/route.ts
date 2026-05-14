// Calendly-watcher cron — every 10 minutes.
//
// Calendly's webhook feature is paid-tier only. To stay 100% free we
// detect Calendly bookings via the confirmation emails that land in
// george@georgeyachts.com (Calendly always sends one). The cron:
//
//   1. Queries Gmail for unread emails from notifications@calendly.com
//      whose subject starts with "New Event:" (the booking-confirmation
//      pattern Calendly has used since 2022).
//   2. Parses invitee name + email + event time + event type from the
//      HTML body.
//   3. Matches the invitee email to an existing contact, or creates a
//      new one with source='calendly_booking'. Moves the contact to
//      the Hot pipeline stage if not already at Negotiation+.
//   4. Logs an `activities` row of type 'calendly_booked'.
//   5. Telegram alert with all the details so George knows the call
//      is on the calendar.
//   6. Marks the Gmail thread as read so we don't re-process.
//
// Free forever — no Calendly webhook subscription required. Catches
// every booking within ~10 minutes of confirmation.

import { NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import { companyFromEmail } from "@/lib/email-signature-parser";

export const runtime = "nodejs";
export const maxDuration = 120;

interface CalendlyBooking {
  message_id: string;
  thread_id: string;
  invitee_email: string;
  invitee_name: string | null;
  event_type: string | null;
  event_time_iso: string | null;
  event_time_display: string | null;
  body_snippet: string;
}

// Gmail q query. Restrict to Calendly's confirmation sender to keep
// noise out + last 7 days so we don't reprocess old bookings if the
// "unread" filter ever misfires.
const GMAIL_QUERY =
  "from:notifications@calendly.com is:unread newer_than:7d";

// Heuristic parsers — Calendly's confirmation HTML is stable but not
// versioned, so we keep them tolerant.
function extractInviteeEmail(body: string): string | null {
  // Calendly explicitly labels it. Both English + Greek bodies use the
  // raw email next to "Invitee" / "Καλεσμένος" / "Email".
  const m =
    body.match(/Invitee\s*\n?\s*<a[^>]*href="mailto:([^"]+)"/i) ||
    body.match(/Invitee[^:]*:\s*([\w.+-]+@[\w.-]+\.[a-z]{2,})/i) ||
    body.match(/href="mailto:([^"]+)"[^>]*>([\w.+-]+@[\w.-]+\.[a-z]{2,})<\/a>/i) ||
    body.match(/<([\w.+-]+@[\w.-]+\.[a-z]{2,})>/i);
  if (!m) return null;
  return (m[1] || m[2] || "").toLowerCase().trim();
}

function extractInviteeName(body: string): string | null {
  // Calendly typically labels with "Invitee" then the name on the
  // next line / table cell.
  const m =
    body.match(/<strong>Invitee<\/strong>[^<]*<[^>]+>([^<]+)</i) ||
    body.match(/Invitee\s*\n?\s*([A-Z][\w'’\-]+(?:\s+[A-Z][\w'’\-]+){0,3})/);
  if (!m) return null;
  return m[1].trim().slice(0, 120);
}

function extractEventType(subject: string, body: string): string | null {
  // The subject line itself usually tells the story:
  //   "New Event: 30 Minute Meeting — Mon, Jan 15, 2026 11:00 AM"
  const m = subject.match(/New Event:\s*([^—\-—]+?)\s*[—\-—]/i);
  if (m) return m[1].trim();
  // Fallback: body usually says "Event Type: …".
  const b = body.match(/Event Type\s*:?\s*([^\n<]+)/i);
  return b ? b[1].trim().slice(0, 200) : null;
}

function extractEventTime(subject: string, body: string): { iso: string | null; display: string | null } {
  // Try subject first, e.g. "— Mon, Jan 15, 2026 11:00 AM"
  const subMatch = subject.match(/[—\-—]\s*(\w+,\s*\w+\s*\d+,\s*\d{4}\s*\d{1,2}:\d{2}\s*[AP]M[^—]*)/i);
  if (subMatch) {
    const display = subMatch[1].trim();
    const iso = parseToIso(display);
    return { iso, display };
  }
  // Body fallback: look for ISO-like or "Day, Mon dd, yyyy hh:mm AM TZ"
  const bMatch =
    body.match(/Event Time[^<]*<[^>]+>([^<]+)</i) ||
    body.match(/(\w+,\s*\w+\s+\d+,\s*\d{4}\s+\d{1,2}:\d{2}\s*[AP]M[^<\n]*)/);
  if (bMatch) {
    const display = bMatch[1].trim().slice(0, 200);
    return { iso: parseToIso(display), display };
  }
  return { iso: null, display: null };
}

function parseToIso(human: string): string | null {
  // Cheap-and-cheerful — Node's Date constructor handles "Jan 15, 2026
  // 11:00 AM" forms. Returns null if it fails.
  const cleaned = human
    .replace(/\s+UTC$|\s+GMT$/i, "Z")
    .replace(/^\s*\w+,\s*/, ""); // strip "Mon, "
  const t = Date.parse(cleaned);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function decodeGmailBody(payload: any): string {
  // Gmail message bodies are base64url-encoded. Concat all text parts.
  const buffers: string[] = [];
  function walk(node: any) {
    if (!node) return;
    if (node.body?.data) {
      try {
        const padded = node.body.data.replace(/-/g, "+").replace(/_/g, "/");
        buffers.push(Buffer.from(padded, "base64").toString("utf8"));
      } catch {}
    }
    for (const part of node.parts || []) walk(part);
  }
  walk(payload);
  return buffers.join("\n");
}

async function _observedImpl(): Promise<Response> {
  if (!process.env.GMAIL_REFRESH_TOKEN && !process.env.GMAIL_CLIENT_ID) {
    return NextResponse.json({ skipped: "gmail not configured" });
  }

  // 1. List candidate messages. The gmailFetch helper prefixes its
  // base URL with `/users/me`, so paths passed in here are relative
  // to that root and must NOT repeat `/users/me`.
  let listed: any = null;
  try {
    const res = await gmailFetch(
      `/messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=20`,
    );
    listed = await res.json();
  } catch (e: any) {
    console.error("[calendly-watcher] gmail list failed:", e);
    return NextResponse.json({ error: e?.message ?? "gmail list failed" }, { status: 500 });
  }

  const messageIds: string[] = (listed?.messages || []).map((m: any) => m.id);
  if (messageIds.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const sb = createServiceClient();

  // Pre-fetch the "Hot" pipeline stage id once.
  let hotStageId: string | null = null;
  try {
    const { data } = await sb
      .from("pipeline_stages")
      .select("id")
      .eq("name", "Hot")
      .limit(1);
    hotStageId = data?.[0]?.id ?? null;
  } catch {}

  const processed: CalendlyBooking[] = [];
  const errors: Array<{ message_id: string; error: string }> = [];

  for (const id of messageIds) {
    try {
      const msgRes = await gmailFetch(`/messages/${id}?format=full`);
      const msg: any = await msgRes.json();
      const headers: Array<{ name: string; value: string }> =
        msg?.payload?.headers || [];
      const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
      const body = decodeGmailBody(msg.payload);

      // Confirm it's a booking-confirmation email (not a reminder or
      // cancellation — we'll add those later if needed).
      if (!/new event:/i.test(subject) && !/scheduled/i.test(subject)) {
        // Mark as read anyway so we don't re-poll the same noise.
        await markAsRead(id).catch(() => {});
        continue;
      }

      const invitee_email = extractInviteeEmail(body);
      if (!invitee_email) {
        errors.push({ message_id: id, error: "no invitee email parsed" });
        await markAsRead(id).catch(() => {});
        continue;
      }

      const invitee_name = extractInviteeName(body);
      const event_type = extractEventType(subject, body);
      const { iso: event_time_iso, display: event_time_display } =
        extractEventTime(subject, body);

      const booking: CalendlyBooking = {
        message_id: id,
        thread_id: msg.threadId,
        invitee_email,
        invitee_name,
        event_type,
        event_time_iso,
        event_time_display,
        body_snippet: body.slice(0, 500).replace(/<[^>]+>/g, " "),
      };

      await upsertContactAndLog(sb, booking, hotStageId);
      await markAsRead(id).catch(() => {});
      processed.push(booking);
    } catch (e: any) {
      console.error("[calendly-watcher] message failed", id, e);
      errors.push({ message_id: id, error: e?.message ?? "unknown" });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: processed.length,
    errors: errors.length,
  });
}

async function markAsRead(messageId: string): Promise<void> {
  await gmailFetch(`/messages/${messageId}/modify`, {
    method: "POST",
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
}

async function upsertContactAndLog(
  sb: any,
  b: CalendlyBooking,
  hotStageId: string | null,
): Promise<void> {
  // 1. Match contact by email.
  const { data: existingRows } = await sb
    .from("contacts")
    .select("id, first_name, last_name, pipeline_stage_id, company")
    .eq("email", b.invitee_email)
    .limit(1);
  let contactId: string | null = existingRows?.[0]?.id ?? null;
  let firstName = existingRows?.[0]?.first_name ?? null;
  let lastName = existingRows?.[0]?.last_name ?? null;
  let company = existingRows?.[0]?.company ?? null;

  // 2. Create if missing.
  if (!contactId) {
    const nameParts = (b.invitee_name || "").split(/\s+/).filter(Boolean);
    firstName = nameParts[0] || null;
    lastName = nameParts.slice(1).join(" ") || null;
    const inferredCompany = companyFromEmail(b.invitee_email);
    company = inferredCompany;
    const inserted = await sb
      .from("contacts")
      .insert({
        email: b.invitee_email,
        first_name: firstName,
        last_name: lastName,
        company,
        source: "calendly_booking",
        pipeline_stage_id: hotStageId,
        last_activity_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    contactId = inserted.data?.id ?? null;
  } else {
    // Existing contact — move to Hot if not already at/past Negotiation.
    if (hotStageId && existingRows[0].pipeline_stage_id !== hotStageId) {
      await sb
        .from("contacts")
        .update({
          pipeline_stage_id: hotStageId,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", contactId);
    }
  }

  if (!contactId) return;

  // 3. Log the activity.
  await sb.from("activities").insert({
    contact_id: contactId,
    type: "calendly_booked",
    description: b.event_type
      ? `Booked a Calendly call — ${b.event_type}${b.event_time_display ? ` at ${b.event_time_display}` : ""}`
      : `Booked a Calendly call${b.event_time_display ? ` at ${b.event_time_display}` : ""}`,
    metadata: {
      event_type: b.event_type,
      event_time_iso: b.event_time_iso,
      event_time_display: b.event_time_display,
      gmail_message_id: b.message_id,
      gmail_thread_id: b.thread_id,
      body_snippet: b.body_snippet,
    },
  });

  // 4. Notifications bell for the in-app dashboard.
  await sb.from("notifications").insert({
    type: "calendly_booking",
    contact_id: contactId,
    title: `📅 New Calendly booking: ${b.invitee_name || b.invitee_email}`,
    description: `${b.event_type ?? "Call"} · ${b.event_time_display ?? "time tbd"}${company ? ` · ${company}` : ""}`,
    link: `/dashboard/contacts/${contactId}`,
  });

  // 5. Telegram alert — high-leverage, real-time.
  await sendTelegram(
    [
      `📅 <b>New Calendly booking</b>`,
      ``,
      `👤 <b>${escapeHtml(b.invitee_name || b.invitee_email)}</b>`,
      `📧 ${escapeHtml(b.invitee_email)}`,
      company ? `🏢 ${escapeHtml(company)}` : "",
      b.event_type ? `🗓️ <b>${escapeHtml(b.event_type)}</b>` : "",
      b.event_time_display ? `⏰ ${escapeHtml(b.event_time_display)}` : "",
      ``,
      `✅ Contact moved to <b>Hot</b> · activity logged.`,
    ]
      .filter(Boolean)
      .join("\n"),
  ).catch((e) => console.error("[calendly-watcher] tg failed:", e));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(): Promise<Response> {
  return observeCron("calendly-watcher", _observedImpl);
}
