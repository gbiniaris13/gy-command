// src/lib/helm/followup/replan.ts
// 16/11/2026 — the plan follows the conversation by itself.
//
// George: "οι ημερομηνίες πρέπει να αλλάζουν σε όλους βάσει όλων των
// συζητήσεων… μπορεί να μιλήσω με κάποιο πελάτη το βράδυ και να μην πρέπει
// να τον κάνω follow-up αύριο, και μετά πρέπει να αλλάζουν και τα επόμενα".
//
// For one request: read every channel (Gmail by address, light; WhatsApp and
// iMessage synced from the Mac; notes), work out who spoke last and when, ask
// the model ONE narrow question only when there is something new to read
// ("does the conversation say to wait until a date?"), then re-time the
// not-done steps in code (rescheduleFromConversation). Ticked steps and dates
// George set by hand are never touched. Sends nothing, drafts nothing.

import { aiChat } from "@/lib/ai";
import { parseLooseJson } from "@/lib/helm/json";
import { createServiceClient } from "@/lib/supabase-server";
import { getMessages, mergePipeline, mergeFollowup } from "@/lib/helm-admin";
import { readPipeline, type FuStep } from "@/lib/helm/pipeline";
import { readFollowupSettings } from "./settings";
import { clientTimezone, localDate, rescheduleFromConversation } from "./calendar";
import { readGmailByAddress, helmItems, timelineStats } from "./context";

export type ReplanResult = { id: string; changed: boolean; reason: string; wait_until?: string | null; next?: string | null; error?: string };

type Row = {
  id: string; status: string; client_email: string | null; client_whatsapp: string | null;
  dates_from: string | null; created_at: string; extraction: unknown;
};

const OPEN = ["sent", "in_conversation", "negotiating"];

async function detectWait(items: { ts: string; direction: string; channel: string; text: string }[], today: string): Promise<{ date: string | null; why: string; needsReply: boolean | null }> {
  const recent = items.filter((i) => i.direction !== "note" && i.text.trim()).slice(-12)
    .map((i) => `[${i.ts.slice(0, 16)} ${i.channel} ${i.direction === "in" ? "CLIENT" : "GEORGE"}] ${i.text.slice(0, 600)}`).join("\n");
  if (!recent) return { date: null, why: "", needsReply: null };
  const sys = `You read the latest messages between a yacht charter broker (George) and a client. Today is ${today}.
Answer ONE question: does the conversation say the next contact should wait until a certain day? Examples: the client is travelling or away until a date, says "talk in January", "after the holidays", "we'll decide next week", "I'll come back to you on Monday"; or George promised to wait or to write on a specific day.
If yes, give the first sensible day to write again (YYYY-MM-DD, in the future: the day after they return, the 2nd business day of the month they named, etc.). If the client is simply silent, or nothing was agreed, answer null.
Second question, only about the LAST message if it is from the CLIENT: does it need an answer from George? A question, a request, a new fact or objection to respond to = true. An acknowledgment such as "thanks", "ok", "let me look at the email", "I'll discuss with my wife", "will get back to you" = false (the ball is with the client). If the last message is from George, answer null.
Output JSON only: {"wait_until": "YYYY-MM-DD" | null, "client_last_needs_reply": true | false | null, "why_el": "one short Greek sentence"}`;
  try {
    const raw = await aiChat(sys, recent, { maxTokens: 2048, temperature: 0, model: process.env.FOLLOWUP_AI_MODEL || undefined });
    const o = parseLooseJson(raw) as { wait_until?: string | null; why_el?: string; client_last_needs_reply?: boolean | null };
    const d = typeof o?.wait_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.wait_until) && o.wait_until > today ? o.wait_until : null;
    const nr = typeof o?.client_last_needs_reply === "boolean" ? o.client_last_needs_reply : null;
    return { date: d, why: (o?.why_el ?? "").toString().slice(0, 200), needsReply: nr };
  } catch {
    return { date: null, why: "", needsReply: null };
  }
}

export async function autoReplan(r: Row, opts: { force?: boolean; dry?: boolean } = {}): Promise<ReplanResult & { plan?: string[] }> {
  if (!OPEN.includes(r.status)) return { id: r.id, changed: false, reason: "not open" };
  const pipeline = readPipeline(r.extraction);
  const fu = pipeline.fu ?? [];
  if (!fu.length) return { id: r.id, changed: false, reason: "no plan" };
  const settings = readFollowupSettings(r.extraction);
  const { tz } = clientTimezone(settings.tz, r.client_whatsapp);
  const now = new Date();
  const nowIso = now.toISOString();
  const today = localDate(now.getTime(), tz);

  const gm = await readGmailByAddress([r.client_email ?? "", ...(settings.extra_emails ?? [])], r.created_at, 40, { light: true, fullLast: 3 });
  if (!gm.ok) return { id: r.id, changed: false, reason: "gmail unreachable", error: "gmail" };
  const msgs = await getMessages(r.id);
  const items = [...gm.items, ...helmItems(msgs)].sort((a, b) => a.ts.localeCompare(b.ts));
  const stats = timelineStats(items);

  // Only ask the model when something new was said since the last look.
  const fState = ((r.extraction as { followup?: Record<string, unknown> } | null)?.followup ?? {}) as Record<string, unknown>;
  const lastSeen = typeof fState.replan_seen_ts === "string" ? fState.replan_seen_ts : "";
  const newestTs = items.filter((i) => i.direction !== "note").at(-1)?.ts ?? "";
  let clientDate = settings.client_followup_date ?? null;
  let waitWhy = "";
  // Does the client's last message need an answer? Remembered per message.
  let needsReply: boolean | null = stats.last_inbound_at && fState.last_in_ts === stats.last_inbound_at && typeof fState.last_in_needs_reply === "boolean"
    ? (fState.last_in_needs_reply as boolean) : null;
  const recentEnough = newestTs && now.getTime() - Date.parse(newestTs) < 45 * 86400000;
  if ((opts.force || newestTs > lastSeen) && recentEnough) {
    const w = await detectWait(items, today);
    if (w.date && (!clientDate || clientDate < today)) { clientDate = w.date; waitWhy = w.why; }
    if (stats.ball === "we_owe" && w.needsReply !== null) needsReply = w.needsReply;
  }

  // A step George ticked (a call, a WhatsApp from the phone, an email by hand)
  // is a contact too, even when no message reached the Helm (17/11, Maya Clem).
  const lastTicked = fu.filter((s) => s.done_at).map((s) => s.done_at as string).sort().at(-1) ?? null;
  const lastOut = [stats.last_outbound_at, lastTicked].filter(Boolean).sort().at(-1) ?? null;
  const res = rescheduleFromConversation(fu as Parameters<typeof rescheduleFromConversation>[0], {
    todayIso: nowIso, tz, charterFrom: r.dates_from, sentAtIso: pipeline.sent_at || r.created_at,
    lastInboundAt: stats.last_inbound_at, lastOutboundAt: lastOut,
    hadInboundAfterFirstOut: stats.had_inbound_after_first_outbound, ball: stats.ball,
    clientFollowupDate: clientDate && clientDate >= today ? clientDate : null,
    lastInboundNeedsReply: stats.ball === "we_owe" ? needsReply : null,
  });
  const ackFirst = stats.ball === "we_owe" && needsReply === false ? res.fu.filter((s) => !s.done_at).map((s) => s.due).sort()[0] ?? null : null;

  if (opts.dry) {
    return { id: r.id, changed: res.changed, reason: res.reason, wait_until: waitWhy ? clientDate : null,
      next: res.fu.filter((s) => !s.done_at).map((s) => s.due).sort()[0] ?? null,
      plan: res.fu.filter((s) => !s.done_at).map((s) => `${s.due}${s.kind === "bye" ? "✕" : ""}${s.anchor ? ` (${s.anchor})` : ""}`) };
  }
  if (res.changed) await mergePipeline(r.id, { fu: res.fu as FuStep[] }, { syncFollowUpAt: true });
  await mergeFollowup(r.id, {
    replan_seen_ts: newestTs || lastSeen || null,
    last_in_ts: stats.last_inbound_at ?? null,
    last_in_needs_reply: needsReply,
    ack_until: ackFirst,
    replanned_at: nowIso,
    replan_reason: waitWhy ? `${res.reason}. ${waitWhy}` : res.reason,
    ...(waitWhy && clientDate ? { client_followup_date: clientDate, client_followup_source: "conversation" } : {}),
  });
  const next = res.fu.filter((s) => !s.done_at).map((s) => s.due).sort()[0] ?? null;
  return { id: r.id, changed: res.changed, reason: res.reason, wait_until: waitWhy ? clientDate : null, next };
}

/** Re-plan many requests with a little concurrency. */
export async function autoReplanMany(ids: string[] | "all-open", opts: { force?: boolean; dry?: boolean; concurrency?: number; deadlineMs?: number } = {}): Promise<(ReplanResult & { plan?: string[] })[]> {
  const db = createServiceClient();
  let q = db.from("helm_requests").select("id, status, client_email, client_whatsapp, dates_from, created_at, extraction").in("status", OPEN);
  if (ids !== "all-open") q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const out: (ReplanResult & { plan?: string[] })[] = [];
  const deadline = Date.now() + (opts.deadlineMs ?? 240000);
  let i = 0;
  const worker = async () => {
    while (i < rows.length && Date.now() < deadline) {
      const r = rows[i++];
      try { out.push(await autoReplan(r, opts)); }
      catch (e) { out.push({ id: r.id, changed: false, reason: "", error: (e as Error).message }); }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  return out;
}
