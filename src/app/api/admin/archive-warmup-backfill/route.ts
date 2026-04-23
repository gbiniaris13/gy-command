// One-shot backfill: scan previously-classified inbox mail and archive
// whatever the new warmup detector now recognises as warmup. Use this
// once after shipping the warmup filter to clean the backlog that the
// first classify pass labelled as NEUTRAL but which is actually fake
// engagement mail from Mailwarm/Lemwarm/Smartlead/etc.
//
// Safe to re-run: we re-check every matched message through the
// detector, so a false positive path can only happen if the detector
// itself is too aggressive (in which case the whole cron is too
// aggressive).

import { NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { detectWarmup } from "@/lib/email-warmup-detector";

export const runtime = "nodejs";
export const maxDuration = 300;

type GmailHeader = { name: string; value: string };
type GmailMessage = {
  id: string;
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    parts?: any[];
    body?: { data?: string };
    mimeType?: string;
  };
};

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

export async function GET() {
  const labelCache = new Map<string, string>();
  const warmupLabelId = await ensureLabel("gy-warmup", labelCache);
  if (!warmupLabelId) {
    return NextResponse.json({ error: "failed to create/find gy-warmup label" }, { status: 500 });
  }
  // Get the IDs of the existing neutral-label so we can find stamped messages
  const listLabelsRes = await gmailFetch("/labels");
  if (!listLabelsRes.ok) return NextResponse.json({ error: "list labels failed" }, { status: 500 });
  const labelsJson = (await listLabelsRes.json()) as { labels?: { id: string; name: string }[] };
  const neutralLabel = (labelsJson.labels ?? []).find((l) => l.name === "gy-classified/neutral");
  if (!neutralLabel) {
    return NextResponse.json({ skipped: "no neutral label yet — cron has not run" });
  }

  // Search: inbox emails previously bucketed as neutral
  const query = "in:inbox label:gy-classified/neutral";
  const listRes = await gmailFetch(
    `/messages?${new URLSearchParams({ q: query, maxResults: "100" })}`,
  );
  if (!listRes.ok) {
    return NextResponse.json(
      { error: "gmail list failed", status: listRes.status },
      { status: 500 },
    );
  }
  const listJson = (await listRes.json()) as { messages?: { id: string }[] };
  const messageIds = listJson.messages ?? [];
  if (messageIds.length === 0) {
    return NextResponse.json({ scanned: 0, archived: 0 });
  }

  let archived = 0;
  let kept = 0;
  const archivedSamples: any[] = [];

  for (const { id } of messageIds) {
    try {
      const res = await gmailFetch(`/messages/${id}?format=full`);
      if (!res.ok) continue;
      const msg = (await res.json()) as GmailMessage;
      const headers = msg.payload?.headers ?? [];
      const from = getHeader(headers, "From");
      const subject = getHeader(headers, "Subject");
      const body = extractBody(msg.payload) || msg.snippet || "";
      const headersMap: Record<string, string> = {};
      for (const h of headers) headersMap[h.name.toLowerCase()] = h.value;

      const verdict = detectWarmup({ from, subject, body, headers: headersMap });
      if (!verdict.isWarmup) {
        kept += 1;
        continue;
      }

      await gmailFetch(`/messages/${id}/modify`, {
        method: "POST",
        body: JSON.stringify({
          addLabelIds: [warmupLabelId],
          removeLabelIds: ["INBOX", "UNREAD", neutralLabel.id],
        }),
      });
      archived += 1;
      if (archivedSamples.length < 10) {
        archivedSamples.push({
          id,
          from: from.slice(0, 80),
          subject: subject.slice(0, 80),
          reason: verdict.reason,
          service: verdict.service,
        });
      }
    } catch (e: any) {
      console.error("[backfill] error on", id, e.message);
    }
  }

  return NextResponse.json({
    scanned: messageIds.length,
    archived,
    kept_as_neutral: kept,
    samples: archivedSamples,
  });
}
