// Gmail auto-classifier cron — every 5 minutes.
//
// Polls the authed inbox (george@georgeyachts.com via gmail_refresh_token)
// for replies on outreach threads. For each new reply:
//   1. Skip if already classified (Gmail label gy-classified/* applied)
//   2. Extract from/subject/body
//   3. Call /api/gmail/classify internally — the classify route already
//      handles HOT/WARM pipeline updates, Telegram alerts, and
//      email_classifications storage. This cron is the TRIGGER that was
//      missing.
//   4. Apply a Gmail label based on the classification so the next tick
//      doesn't re-process the same email.
//
// Pipeline behavior (Option B agreed 23/04):
//   HOT      → contact stage = Hot, Telegram 🔴 alert, activity logged
//   WARM     → contact stage = Warm, Telegram 🟡 alert, activity logged
//   COLD     → NO stage change (history preserved), activity note added:
//              "replied: declined — <AI reason>"
//   NEUTRAL  → skip (auto-reply / OOO / newsletter); follow-up continues

import { NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

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
} as const;

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return "";
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

// Recursively extract text body from a Gmail payload. Prefer text/plain,
// fall back to text/html with crude tag stripping.
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
      // Prefer plain over html
      const plain = part.parts.find((p: any) => (p.mimeType || "").toLowerCase() === "text/plain");
      if (plain) return walk(plain);
      return part.parts.map(walk).join("\n");
    }
    return "";
  };
  return walk(payload).slice(0, 8000);
}

// Ensure a Gmail label exists — create if missing — return its id.
async function ensureLabel(name: string, cache: Map<string, string>): Promise<string | null> {
  if (cache.has(name)) return cache.get(name)!;
  const listRes = await gmailFetch("/labels");
  if (!listRes.ok) return null;
  const listJson = (await listRes.json()) as { labels?: { id: string; name: string }[] };
  const existing = (listJson.labels ?? []).find((l) => l.name === name);
  if (existing) {
    cache.set(name, existing.id);
    return existing.id;
  }
  // Create it
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

// For COLD classifications: log an activity note on the matched contact
// but DON'T change pipeline_stage (Option B — history preserved).
async function logColdActivity(args: {
  fromEmail: string;
  subject: string;
  reason: string;
  messageId: string;
}): Promise<void> {
  const sb = createServiceClient();
  const { data: contact } = await sb
    .from("contacts")
    .select("id, pipeline_stage_id")
    .ilike("email", args.fromEmail)
    .maybeSingle();
  if (!contact?.id) return;

  await sb.from("activities").insert({
    contact_id: contact.id,
    type: "email_reply_cold",
    description: `Replied: declined — ${args.reason}`.slice(0, 500),
    metadata: {
      message_id: args.messageId,
      subject: args.subject,
      classification: "COLD",
    },
  });
  await sb
    .from("contacts")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", contact.id);
}

async function processMessage(
  messageId: string,
  labelCache: Map<string, string>,
): Promise<{ ok: boolean; classification?: string; reason?: string }> {
  // Fetch full message
  const res = await gmailFetch(
    `/messages/${messageId}?format=full`,
  );
  if (!res.ok) return { ok: false, reason: `fetch ${res.status}` };
  const msg = (await res.json()) as GmailMessage;

  const headers = msg.payload?.headers ?? [];
  const from = getHeader(headers, "From");
  const subject = getHeader(headers, "Subject");
  const body = extractBody(msg.payload) || msg.snippet || "";

  const headersMap: Record<string, string> = {};
  for (const h of headers) headersMap[h.name.toLowerCase()] = h.value;

  const result = await classifyViaApi({
    messageId,
    from,
    subject,
    body,
    headers: headersMap,
  });
  if (!result) return { ok: false, reason: "classify api failed" };

  // Extract sender email for COLD handling
  const emailMatch = from.match(/<([^>]+)>/);
  const senderEmail = (emailMatch?.[1] ?? from).toLowerCase().trim();

  // Option B: COLD logs activity, does NOT move stage.
  // The classify route already skips CRM updates for COLD/NEUTRAL, so we
  // only need to ADD the cold-reply activity here.
  if (result.classification === "COLD") {
    await logColdActivity({
      fromEmail: senderEmail,
      subject,
      reason: result.reason ?? "declined",
      messageId,
    });
  }

  // Apply dedup labels
  const classifiedLabelId = await ensureLabel(LABEL_NAMES.classified, labelCache);
  const bucketLabelName =
    result.classification === "HOT"
      ? LABEL_NAMES.hot
      : result.classification === "WARM"
        ? LABEL_NAMES.warm
        : result.classification === "COLD"
          ? LABEL_NAMES.cold
          : LABEL_NAMES.neutral;
  const bucketLabelId = await ensureLabel(bucketLabelName, labelCache);
  const labels = [classifiedLabelId, bucketLabelId].filter(Boolean) as string[];
  await applyLabels(messageId, labels);

  return { ok: true, classification: result.classification };
}

export async function GET() {
  try {
    // Search for inbox replies that we haven't classified yet.
    // We exclude our own outgoing mail via -from:me.
    // Exclude explicit spam/trash + already-labeled.
    const query = [
      "in:inbox",
      "-from:me",
      "-label:gy-classified",
      "newer_than:2d",
    ].join(" ");

    const listRes = await gmailFetch(
      `/messages?${new URLSearchParams({ q: query, maxResults: "25" })}`,
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
        if (!r.ok) acc.failed += 1;
        else if (r.classification) acc[r.classification.toLowerCase()] = (acc[r.classification.toLowerCase()] ?? 0) + 1;
        return acc;
      },
      { failed: 0 } as Record<string, number>,
    );

    // Silent unless something hot or many processed; daily summary runs elsewhere.
    if ((summary.hot ?? 0) > 0) {
      // The classify route already fired per-HOT Telegram alerts; keep this cron silent.
    }

    return NextResponse.json({ processed: results.length, summary, results });
  } catch (e: any) {
    await sendTelegram(
      `⚠️ <b>Gmail poll-replies cron crashed</b>\n<code>${(e.message ?? "unknown").slice(0, 400)}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 });
  }
}
