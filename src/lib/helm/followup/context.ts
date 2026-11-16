// src/lib/helm/followup/context.ts
// Builds the ONE timeline a follow-up must be written from (SKILL STEP 1).
//
// Measured 16/11/2026: Gmail held 228 client replies across these requests,
// the Helm had captured 26, because 80 of 128 requests live in more than one
// thread. So this reads Gmail by ADDRESS (the client plus any spouse /
// assistant / advisor addresses George added), every thread, including the
// emails George wrote by hand outside the Helm. Pasted WhatsApp chats and
// George's notes from the Helm ride along. Read-only: nothing is written here.

import { gmailFetch } from "@/lib/google-api";

export type TimelineItem = {
  ts: string; // ISO
  channel: "email" | "whatsapp" | "imessage" | "note";
  direction: "in" | "out" | "note";
  author: string;
  subject?: string;
  text: string;
  thread_id?: string;
  message_id?: string; // Gmail API id
  rfc_message_id?: string; // the Message-ID header, for In-Reply-To
};

export type HelmMsg = { direction: string | null; channel: string | null; body: string | null; created_at: string; gmail_message_id?: string | null };

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };
type GmailMsg = { id: string; threadId: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart };

const OURS = /@georgeyachts\.com\b/i;

function b64(data: string): string {
  try { return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch { return ""; }
}
function findPart(p: GmailPart | undefined, mime: string): string | null {
  if (!p) return null;
  if (p.mimeType === mime && p.body?.data) return b64(p.body.data);
  for (const c of p.parts ?? []) { const r = findPart(c, mime); if (r) return r; }
  return null;
}
function htmlToText(h: string): string {
  return h.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
/** The new words only: no quoted history, no signature block, no pixel junk. */
export function cleanBody(raw: string): string {
  let t = raw.replace(/\r/g, "");
  const cuts = [
    /\n\s*On [^\n]{6,200}wrote:\s*\n/i,
    /\n\s*Στις [^\n]{6,200}έγραψε:\s*\n/i,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\n_{5,}\s*\n\s*From:/i,
    /\nFrom: [^\n]+\n(Sent|Date): /i,
    /\n-- \n/,
  ];
  for (const re of cuts) { const m = t.match(re); if (m && m.index !== undefined) t = t.slice(0, m.index); }
  t = t.split("\n").filter((l) => !/^\s*>/.test(l)).join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim().slice(0, 2500);
}

const header = (m: GmailMsg, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

export type GmailRead = {
  items: TimelineItem[];
  newAddresses: string[]; // seen in To/Cc next to the client, not yet linked
  ok: boolean;
};

/** Every email to/from these addresses since the request arrived. */
export async function readGmailByAddress(addresses: string[], sinceIso: string, limit = 40, opts: { light?: boolean; fullLast?: number } = {}): Promise<GmailRead> {
  const addrs = addresses.map((a) => a.trim().toLowerCase()).filter((a) => a.includes("@"));
  if (!addrs.length) return { items: [], newAddresses: [], ok: true };
  const after = Math.floor((Date.parse(sinceIso) - 2 * 86400000) / 1000);
  const q = `(${addrs.map((a) => `from:${a} OR to:${a} OR cc:${a}`).join(" OR ")}) after:${after}`;
  const list = await gmailFetch(`/messages?q=${encodeURIComponent(q)}&maxResults=${limit}`);
  if (!list.ok) return { items: [], newAddresses: [], ok: false };
  const ids = ((await list.json()).messages ?? []) as { id: string }[];
  const seen = new Set<string>();
  const items: TimelineItem[] = [];
  // light = dates and senders only (the hourly re-plan), except the newest
  // `fullLast` messages, whose words are needed to spot "wait until…".
  const fullIds = new Set(ids.slice(0, opts.fullLast ?? (opts.light ? 0 : ids.length)).map((x) => x.id));
  await Promise.all(ids.map(async ({ id }) => {
    const full = !opts.light || fullIds.has(id);
    const r = await gmailFetch(full ? `/messages/${id}?format=full` : `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID`);
    if (!r.ok) return;
    const m = (await r.json()) as GmailMsg;
    if (m.labelIds?.includes("DRAFT")) return;
    const from = header(m, "From");
    const out = OURS.test(from);
    for (const h of [header(m, "To"), header(m, "Cc"), from]) {
      for (const a of h.toLowerCase().match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []) {
        if (!OURS.test(a) && !addrs.includes(a)) seen.add(a);
      }
    }
    const plain = findPart(m.payload, "text/plain") ?? htmlToText(findPart(m.payload, "text/html") ?? "");
    items.push({
      ts: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
      channel: "email",
      direction: out ? "out" : "in",
      author: out ? "George" : (from.replace(/<.*>/, "").replace(/"/g, "").trim() || from),
      subject: header(m, "Subject"),
      text: cleanBody(plain),
      thread_id: m.threadId,
      message_id: m.id,
      rfc_message_id: header(m, "Message-ID") || header(m, "Message-Id") || undefined,
    });
  }));
  items.sort((a, b) => a.ts.localeCompare(b.ts));
  // Newsletters, receipts and no-reply robots are not new people.
  const newAddresses = Array.from(seen).filter((a) => !/no-?reply|mailer|notifications?@|bounce|calendar-|docs\.google/i.test(a)).slice(0, 5);
  return { items, newAddresses, ok: true };
}

/** Pasted WhatsApp chats and George's own notes, from helm_messages. Emails
 *  logged there are skipped (Gmail is the source of truth for email). */
export function helmItems(msgs: HelmMsg[]): TimelineItem[] {
  return msgs
    .filter((m) => (m.body ?? "").trim() && m.channel !== "email")
    .map((m) => {
      const body = (m.body ?? "").trim();
      // iMessage/SMS synced from the Mac is stored as a note with a prefix
      // (the channel column allows email|whatsapp|note) but it IS conversation.
      const im = m.channel === "note" && body.startsWith("[iMessage/SMS") && !!m.direction;
      const talk = m.channel === "whatsapp" || im;
      return {
        ts: m.created_at,
        channel: m.channel === "whatsapp" ? ("whatsapp" as const) : im ? ("imessage" as const) : ("note" as const),
        direction: talk ? (m.direction === "inbound" ? "in" as const : "out" as const) : ("note" as const),
        author: talk ? (m.direction === "inbound" ? "Client" : "George") : "George (Helm note)",
        text: (im ? body.replace(/^\[iMessage\/SMS[^\]]*\]\s*/, "") : body).slice(0, 2500),
      };
    });
}

export type TimelineStats = {
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  first_outbound_at: string | null;
  had_inbound_after_first_outbound: boolean;
  consecutive_unanswered: number; // George's TOUCHES since the client last wrote (an email + its WhatsApp within 6 h = one touch)
  wa_consecutive_unanswered: number; // WhatsApp messages from George since the client last wrote anywhere
  last_wa_out_at: string | null;
  ball: "client_owes" | "we_owe" | "none";
  latest_thread: { thread_id: string; subject: string; rfc_message_id?: string } | null;
};

export function timelineStats(items: TimelineItem[]): TimelineStats {
  const conv = items.filter((i) => i.direction !== "note");
  const lastIn = [...conv].reverse().find((i) => i.direction === "in") ?? null;
  const outs = conv.filter((i) => i.direction === "out");
  const firstOut = outs[0] ?? null;
  let run = 0; let prevOutTs: string | null = null; let waRun = 0; let lastWaOut: string | null = null;
  for (const i of conv) {
    if (i.direction === "in") { run = 0; waRun = 0; prevOutTs = null; continue; }
    if (i.channel === "whatsapp") { waRun++; lastWaOut = i.ts; }
    // One touch = the email and its WhatsApp companion sent the same morning.
    if (prevOutTs && Date.parse(i.ts) - Date.parse(prevOutTs) < 6 * 3600000) continue;
    run++; prevOutTs = i.ts;
  }
  const last = conv.at(-1) ?? null;
  // Reply in the newest EMAIL thread that the client is part of.
  const lastEmail = [...items].reverse().find((i) => i.channel === "email" && i.thread_id) ?? null;
  const threadMsgs = lastEmail ? items.filter((i) => i.thread_id === lastEmail.thread_id) : [];
  const tail = threadMsgs.at(-1);
  return {
    last_inbound_at: lastIn?.ts ?? null,
    last_outbound_at: outs.at(-1)?.ts ?? null,
    first_outbound_at: firstOut?.ts ?? null,
    had_inbound_after_first_outbound: !!(firstOut && lastIn && lastIn.ts > firstOut.ts),
    consecutive_unanswered: run,
    wa_consecutive_unanswered: waRun,
    last_wa_out_at: lastWaOut,
    ball: !last ? "none" : last.direction === "in" ? "we_owe" : "client_owes",
    latest_thread: lastEmail
      ? { thread_id: lastEmail.thread_id!, subject: (threadMsgs[0]?.subject || lastEmail.subject || "").trim(), rfc_message_id: tail?.rfc_message_id }
      : null,
  };
}

/** Long histories: every inbound kept, the last 15 outbound in full, older
 *  outbound reduced to a one-line stub (the brief's rule). */
export function trimForModel(items: TimelineItem[]): TimelineItem[] {
  const outs = items.filter((i) => i.direction === "out");
  const keepOut = new Set(outs.slice(-15));
  return items.map((i) => (i.direction === "out" && !keepOut.has(i) ? { ...i, text: `[older message from George, ${i.text.slice(0, 160)}…]` } : i));
}
