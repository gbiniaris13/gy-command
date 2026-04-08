import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
  headers?: GmailHeader[];
}

interface GmailFullMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate: string;
  payload: GmailPart;
}

function getHeader(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractBody(part: GmailPart): { html: string; text: string } {
  let html = "";
  let text = "";

  if (part.mimeType === "text/html" && part.body?.data) {
    html = decodeBase64Url(part.body.data);
  } else if (part.mimeType === "text/plain" && part.body?.data) {
    text = decodeBase64Url(part.body.data);
  }

  if (part.parts) {
    for (const sub of part.parts) {
      const result = extractBody(sub);
      if (result.html) html = result.html;
      if (result.text && !text) text = result.text;
    }
  }

  return { html, text };
}

function extractAttachments(part: GmailPart, list: { filename: string; mimeType: string; size: number }[] = []) {
  if (part.filename && part.body?.attachmentId) {
    list.push({
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.body.size ?? 0,
    });
  }
  if (part.parts) {
    for (const sub of part.parts) {
      extractAttachments(sub, list);
    }
  }
  return list;
}

/** Strip <script> tags and on* event handlers for XSS prevention */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=[^\s>]*/gi, "")
    .replace(/javascript\s*:/gi, "blocked:");
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const res = await gmailFetch(`/messages/${id}?format=full`);
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const msg: GmailFullMessage = await res.json();
    const headers = msg.payload.headers ?? [];
    const { html, text } = extractBody(msg.payload);
    const attachments = extractAttachments(msg.payload);

    return NextResponse.json({
      id: msg.id,
      threadId: msg.threadId,
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      subject: getHeader(headers, "Subject"),
      date: getHeader(headers, "Date") || new Date(parseInt(msg.internalDate)).toISOString(),
      labelIds: msg.labelIds ?? [],
      isStarred: (msg.labelIds ?? []).includes("STARRED"),
      body: html ? sanitizeHtml(html) : text,
      bodyType: html ? "html" : "text",
      attachments,
    });
  } catch (err) {
    console.error("[Gmail] Get message error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
