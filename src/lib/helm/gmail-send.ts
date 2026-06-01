// src/lib/helm/gmail-send.ts
// Gmail send for The Helm — extends the createRawEmail idea with ATTACHMENTS
// (multipart/mixed) so the proposal PDF rides along. Sends via the existing
// gmailFetch (gmail.send scope). Used by the auth-gated /send route and the
// follow-up cron's reminder-to-George. NEVER auto-sends to a client — callers
// trigger it only after George confirms.

import { gmailFetch } from "@/lib/google-api";

export type Attachment = { filename: string; mimeType: string; base64: string };

function b64wrap(s: string): string {
  // RFC-2045: wrap base64 at 76 chars for maximal client compatibility.
  return s.replace(/.{76}/g, "$&\r\n");
}

// Build a base64url raw RFC-822 message. With attachments → multipart/mixed
// wrapping a multipart/alternative (text+html); without → multipart/alternative
// (same shape the general /api/gmail/send uses).
export function buildRawEmail(args: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  attachments?: Attachment[];
}): string {
  const alt = "alt_" + Math.random().toString(36).slice(2);
  const altBlock = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    args.body,
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    args.body.replace(/\n/g, "<br>"),
    `--${alt}--`,
  ].join("\r\n");

  const headers = [`To: ${args.to}`, `Subject: ${args.subject}`, "MIME-Version: 1.0"];
  if (args.inReplyTo) {
    headers.push(`In-Reply-To: ${args.inReplyTo}`, `References: ${args.inReplyTo}`);
  }

  let raw: string;
  if (args.attachments && args.attachments.length) {
    const mix = "mix_" + Math.random().toString(36).slice(2);
    const lines = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mix}"`,
      "",
      `--${mix}`,
      altBlock,
    ];
    for (const a of args.attachments) {
      lines.push(
        `--${mix}`,
        `Content-Type: ${a.mimeType}; name="${a.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${a.filename}"`,
        "",
        b64wrap(a.base64),
      );
    }
    lines.push(`--${mix}--`);
    raw = lines.join("\r\n");
  } else {
    raw = [...headers, altBlock].join("\r\n");
  }
  return Buffer.from(raw).toString("base64url");
}

export async function sendHelmEmail(args: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  attachments?: Attachment[];
}): Promise<{ messageId: string; threadId: string }> {
  const raw = buildRawEmail(args);
  const sendBody: Record<string, string> = { raw };
  if (args.threadId) sendBody.threadId = args.threadId;
  const res = await gmailFetch("/messages/send", { method: "POST", body: JSON.stringify(sendBody) });
  if (!res.ok) throw new Error(`gmail send ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { messageId: data.id, threadId: data.threadId };
}
