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

// Crude HTML -> text for the text/plain alternative of the signature.
function htmlToText(html: string): string {
  return html
    .replace(/<\/(div|p|tr|table|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The Gmail web client appends the user's signature when composing; the API
// send does NOT. Fetch the primary sendAs signature (HTML) so Helm emails carry
// George's normal signature. Cached for the lambda lifetime; "" on any failure
// (graceful — the email still sends, just without the signature).
let _cachedSignature: string | null = null;
export async function getGmailSignature(): Promise<string> {
  if (_cachedSignature !== null) return _cachedSignature;
  try {
    const res = await gmailFetch("/settings/sendAs");
    if (!res.ok) { _cachedSignature = ""; return ""; }
    const data = await res.json();
    const list: { isPrimary?: boolean; isDefault?: boolean; signature?: string }[] =
      Array.isArray(data.sendAs) ? data.sendAs : [];
    const primary = list.find((s) => s.isPrimary) || list.find((s) => s.isDefault) || list[0];
    _cachedSignature = primary?.signature || "";
  } catch {
    _cachedSignature = "";
  }
  return _cachedSignature;
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
  signatureHtml?: string;
}): string {
  const alt = "alt_" + Math.random().toString(36).slice(2);
  const sig = args.signatureHtml?.trim() ? args.signatureHtml : "";
  const textBody = sig ? `${args.body}\n\n${htmlToText(sig)}` : args.body;
  const htmlBody = `${args.body.replace(/\n/g, "<br>")}${sig ? `<br><br>${sig}` : ""}`;
  const altBlock = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    textBody,
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    htmlBody,
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
  const signatureHtml = await getGmailSignature();
  const raw = buildRawEmail({ ...args, signatureHtml });
  const sendBody: Record<string, string> = { raw };
  if (args.threadId) sendBody.threadId = args.threadId;
  const res = await gmailFetch("/messages/send", { method: "POST", body: JSON.stringify(sendBody) });
  if (!res.ok) throw new Error(`gmail send ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { messageId: data.id, threadId: data.threadId };
}
