// Daily read of the journalist-request inboxes.
//
// 2026-08-08. See src/lib/media-requests.ts for why this exists: 201 requests
// from HARO, Qwoted and Source of Sources arrived in ninety days and not one
// was read, while eight hand-written cold pitches went out and produced
// nothing. This turns the fuel that already arrives into something George can
// act on in five minutes over coffee.
//
// It reads, scores and sends one email. It never answers anything itself:
// a journalist can tell when a person did not write the reply, and the whole
// proposition of this house is that a person answers.

import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import {
  scoreRequest,
  toBlocks,
  findDeadline,
  findOutlet,
  draftAnswer,
} from "@/lib/media-requests";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SENDERS = [
  "haro@helpareporter.com",
  "peter@sourceofsources.com",
  "notifications@qwoted.com",
  "support@qwoted.com",
  "noreply@connectively.us",
  "noreply@sourcebottle.com",
];

// One solid core keyword scores 3. Four is a real match: either two core hits,
// or one core hit plus the outlet or a region. Lower than that and the digest
// fills with travel stories that have nothing to do with chartering.
const MIN_SCORE = 4;
const MAX_IN_EMAIL = 8;

interface Match {
  source: string;
  subject: string;
  outlet: string | null;
  deadline: string | null;
  score: number;
  hits: string[];
  block: string;
  draft: string;
  // HARO gives a per-query reply address; answering that address IS the pitch.
  replyTo: string | null;
}

function decode(b64?: string): string {
  if (!b64) return "";
  try {
    return Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  } catch {
    return "";
  }
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

/** Prefer text/plain anywhere in the tree; fall back to stripped HTML. */
function extractText(payload?: GmailPart): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decode(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) {
      const t = extractText(p);
      if (t) return t;
    }
    for (const p of payload.parts) {
      if (p.mimeType === "text/html" && p.body?.data) {
        return decode(p.body.data)
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<[^>]+>/g, "\n")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\n{3,}/g, "\n\n");
      }
    }
  }
  if (payload.body?.data) return decode(payload.body.data);
  return "";
}

function createRawEmail(to: string, subject: string, body: string): string {
  const lines = [
    "From: George Yachts <george@georgeyachts.com>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

async function _observedImpl(request: NextRequest): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  const isVercelCron = request.headers.get("user-agent")?.includes("vercel-cron");
  if (!isVercelCron && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const q = `(${SENDERS.map((s) => `from:${s}`).join(" OR ")}) newer_than:1d`;
  const listRes = await gmailFetch(
    `/messages?${new URLSearchParams({ q, maxResults: "25" })}`
  );
  if (!listRes.ok) {
    await sendTelegram(
      "⚠️ Media-request digest could not read Gmail. Today's journalist requests were not checked."
    );
    return NextResponse.json({ ok: false, reason: "gmail-list-failed" });
  }

  const listJson = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (listJson.messages || []).map((m) => m.id);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, matched: 0 });
  }

  const seen = new Set<string>();
  const matches: Match[] = [];

  for (const id of ids) {
    const res = await gmailFetch(`/messages/${id}?format=full`);
    if (!res.ok) continue;
    const msg = (await res.json()) as {
      payload?: GmailPart & { headers?: { name: string; value: string }[] };
    };
    const headers = Object.fromEntries(
      (msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value])
    );
    const subject = headers.subject || "";
    const body = extractText(msg.payload);
    if (!body) continue;

    for (const block of toBlocks(body)) {
      const verdict = scoreRequest(block.text, subject);
      if (verdict.score < MIN_SCORE) continue;

      // The same request runs in the morning and afternoon editions, and HARO
      // repeats the summary line verbatim, so the first 90 characters are a
      // reliable fingerprint.
      const key = block.text.slice(0, 90).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      matches.push({
        source: (headers.from || "").replace(/.*<|>.*/g, "") || headers.from || "",
        subject,
        // HARO states the outlet and deadline in named fields, which toBlocks
        // already lifted. Qwoted and SOS do not, so fall back to reading them
        // out of the prose.
        outlet: block.outlet ?? findOutlet(block.text, subject),
        deadline: block.deadline ?? findDeadline(block.text),
        score: verdict.score,
        hits: verdict.hits,
        block: block.text,
        draft: draftAnswer(block.text),
        replyTo: block.replyTo,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, MAX_IN_EMAIL);

  if (top.length === 0) {
    // Silence on a quiet day. George does not need to be told that yachting
    // did not come up, and an alert that fires on nothing gets ignored when
    // it fires on something.
    return NextResponse.json({ ok: true, scanned: ids.length, matched: 0 });
  }

  const body =
    `${top.length} journalist ${top.length === 1 ? "request" : "requests"} worth answering today.\n\n` +
    `Read from ${ids.length} HARO, Qwoted and Source of Sources emails in the last 24 hours. ` +
    `These mention yachting, chartering or luxury travel. Someone who asks is already looking for a source, ` +
    `which is why these are worth your time where a cold pitch is not.\n\n` +
    `Answer in your own words. The drafts are a starting point and a journalist can tell the difference.\n\n` +
    top
      .map((m, i) => {
        const head = [m.outlet || m.source, m.deadline].filter(Boolean).join("  |  ");
        const replyLine = m.replyTo ? `\nREPLY TO\n${m.replyTo}\n` : "";
        return (
          `${"=".repeat(60)}\n` +
          `${i + 1}. ${head}\n` +
          `${"=".repeat(60)}\n\n` +
          `THE REQUEST\n${m.block}\n` +
          replyLine +
          `\n` +
          `A STARTING POINT\n${m.draft}\n`
        );
      })
      .join("\n") +
    `\n${"=".repeat(60)}\nNothing was sent on your behalf. Deadlines are quoted from the request itself where one was stated.\n`;

  const subject =
    top.length === 1
      ? `1 journalist request worth answering${top[0].outlet ? `: ${top[0].outlet}` : ""}`
      : `${top.length} journalist requests worth answering today`;

  const sendRes = await gmailFetch("/messages/send", {
    method: "POST",
    body: JSON.stringify({
      raw: createRawEmail("george@georgeyachts.com", subject, body),
    }),
  });

  return NextResponse.json({
    ok: true,
    scanned: ids.length,
    matched: matches.length,
    sent: sendRes.ok ? top.length : 0,
    emailOk: sendRes.ok,
    outlets: top.map((m) => m.outlet || m.source),
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return observeCron("media-requests", () => _observedImpl(request));
}
