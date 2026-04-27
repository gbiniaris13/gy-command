// Gmail send — outbound email + activity logging.
//
// Every send writes an `email_sent` activity against the matching
// contact (looked up by `to` email, case-insensitive). Without this
// log the cockpit cannot tell when George last reached out, which
// breaks the Inbox Brain pillar (gap, owed-reply, stage inference).
//
// If no contact matches the recipient, we silently skip the activity
// log — outbound to unknown addresses is allowed (e.g. one-off
// admin emails). The send itself never fails because of CRM lookup.

import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";
import { refreshContactInbox } from "@/lib/inbox-analyzer";

function createRawEmail(
  to: string,
  subject: string,
  body: string,
  threadId?: string,
  inReplyTo?: string
): string {
  const boundary = "boundary_" + Date.now();
  const lines: string[] = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${inReplyTo}`);
  }

  lines.push("", `--${boundary}`);
  lines.push("Content-Type: text/plain; charset=UTF-8", "", body);
  lines.push(
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    body.replace(/\n/g, "<br>")
  );
  lines.push(`--${boundary}--`);

  void threadId;

  const raw = lines.join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

function extractRecipientEmail(to: string): string | null {
  const m = to.match(/<([^>]+)>/);
  const candidate = (m ? m[1] : to).trim().toLowerCase();
  return /.+@.+\..+/.test(candidate) ? candidate : null;
}

async function logOutboundActivity(args: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  messageId: string;
}): Promise<void> {
  const recipient = extractRecipientEmail(args.to);
  if (!recipient) return;

  const sb = createServiceClient();
  const { data: contact } = await sb
    .from("contacts")
    .select("id")
    .ilike("email", recipient)
    .maybeSingle();

  if (!contact?.id) return;

  const now = new Date().toISOString();
  await sb.from("activities").insert({
    contact_id: contact.id,
    type: "email_sent",
    description: `Sent — ${args.subject}`.slice(0, 500),
    metadata: {
      message_id: args.messageId,
      thread_id: args.threadId ?? null,
      subject: args.subject,
      snippet: args.body.slice(0, 300),
      direction: "outbound",
    },
  });
  await sb
    .from("contacts")
    .update({ last_activity_at: now })
    .eq("id", contact.id);

  // Pillar 1 — recompute inbox state so the cockpit immediately
  // reflects the new outbound message (e.g. moves contact out of
  // owed_reply into awaiting_reply).
  await refreshContactInbox(sb, contact.id);
}

export async function POST(request: NextRequest) {
  try {
    const { to, subject, body, threadId, inReplyTo } = await request.json();

    if (!to || !body) {
      return NextResponse.json(
        { error: "Missing required fields: to, body" },
        { status: 400 }
      );
    }

    const raw = createRawEmail(to, subject ?? "", body, threadId, inReplyTo);

    const sendBody: Record<string, string> = { raw };
    if (threadId) {
      sendBody.threadId = threadId;
    }

    const res = await gmailFetch("/messages/send", {
      method: "POST",
      body: JSON.stringify(sendBody),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const data = await res.json();

    // Best-effort activity log — never fail the send because of it.
    logOutboundActivity({
      to,
      subject: subject ?? "",
      body,
      threadId,
      messageId: data.id,
    }).catch((err) => {
      console.error("[Gmail] outbound activity log failed:", err);
    });

    return NextResponse.json({ success: true, messageId: data.id });
  } catch (err) {
    console.error("[Gmail] Send error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
