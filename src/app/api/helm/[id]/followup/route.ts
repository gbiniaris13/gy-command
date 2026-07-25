// POST /api/helm/:id/followup — follow up on a proposal already sent.
//   { action: "generate" }        -> compose an editable follow-up draft (no send)
//   { action: "send", body }      -> send it as a reply IN THE SAME Gmail thread
// Goes to the same recipient as the original proposal (the client, or the travel
// agent), threaded so it reads as a natural follow-up. Voice adapts to the
// request type (direct client vs travel agent). NEVER auto-sends - the UI requires
// an explicit confirm and this route only sends on action "send". No new DB
// columns: the follow-up number is derived by counting prior logged follow-ups.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, getMessages, logHelmMessage, mergePipeline } from "@/lib/helm-admin";
import { createServiceClient } from "@/lib/supabase-server";
import { helmSalutation } from "@/lib/helm/addressing";
import { composeFollowUp } from "@/lib/helm/compose";
import { sendHelmEmail } from "@/lib/helm/gmail-send";
import { readPipeline, suggestFollowUps, nextDueTimestamp } from "@/lib/helm/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

const FOLLOWUP_TAG = "[Follow-up";

async function adminEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const jar = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  // ── 2026-07-24 pipeline-plan actions (George edits the 3 suggested dates
  // and ticks steps done straight from the Charter Pipeline list). These do
  // not need a Gmail thread: notes exist before a send, and a plan can be
  // laid on an already-sent request that predates the feature. ────────────

  // NOTES: George's own hand-written state of play, saved from the list.
  if (action === "notes-set") {
    const notes = (body?.notes ?? "").toString().slice(0, 4000);
    await mergePipeline(id, { notes });
    return NextResponse.json({ ok: true });
  }

  // WANTED NIGHTS: what the client actually asked for inside a flexible
  // window ("a week in August"), so the row stops claiming "29 nights".
  if (action === "wanted-nights") {
    const n = Number(body?.nights);
    const wanted = Number.isFinite(n) && n > 0 && n < 100 ? Math.round(n) : null;
    await mergePipeline(id, { wanted_nights: wanted });
    return NextResponse.json({ ok: true, wanted_nights: wanted });
  }

  // PLAN-INIT: lay the 3 suggested dates on a request sent before this
  // feature existed (one click from the list).
  if (action === "plan-init") {
    const pipeline = readPipeline(r.extraction);
    if (!pipeline.fu || pipeline.fu.length !== 3) {
      const sentAt = pipeline.sent_at || r.last_activity_at || new Date().toISOString();
      pipeline.fu = suggestFollowUps(sentAt, r.dates_from ?? null);
      if (!pipeline.sent_at) pipeline.sent_at = sentAt;
      await mergePipeline(id, { fu: pipeline.fu, sent_at: pipeline.sent_at }, { syncFollowUpAt: true });
    }
    return NextResponse.json({ ok: true, fu: pipeline.fu });
  }

  // PLAN-SET: George changes one suggested date by hand ("told him on the
  // phone I would come back in three days").
  if (action === "plan-set") {
    const step = Number(body?.step);
    const date = (body?.date ?? "").toString();
    if (![0, 1, 2].includes(step) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "bad step/date" }, { status: 400 });
    }
    const pipeline = readPipeline(r.extraction);
    if (!pipeline.fu || !pipeline.fu[step]) {
      return NextResponse.json({ error: "no plan on this request yet" }, { status: 400 });
    }
    pipeline.fu[step] = { ...pipeline.fu[step], due: date };
    await mergePipeline(id, { fu: pipeline.fu }, { syncFollowUpAt: true });
    return NextResponse.json({ ok: true, fu: pipeline.fu });
  }

  // PLAN-DONE: "I actually followed up" (WhatsApp, call, anywhere) - one
  // click. Marks the step, writes the history line, and follow_up_at moves
  // to the next not-done step so the daily reminder stays truthful.
  if (action === "plan-done") {
    const step = Number(body?.step);
    const how = (body?.how ?? "").toString().slice(0, 40) || null;
    const pipeline = readPipeline(r.extraction);
    if (![0, 1, 2].includes(step) || !pipeline.fu || !pipeline.fu[step]) {
      return NextResponse.json({ error: "no plan/step" }, { status: 400 });
    }
    if (!pipeline.fu[step].done_at) {
      pipeline.fu[step] = { ...pipeline.fu[step], done_at: new Date().toISOString(), how };
      await mergePipeline(id, { fu: pipeline.fu }, { syncFollowUpAt: true });
      const label = step === 2 ? "final courtesy note" : `follow-up ${step + 1}`;
      try {
        await logHelmMessage(id, {
          direction: "outbound",
          channel: "note",
          body: `[Follow-up ${step + 1}] done (${how || "logged from the pipeline"}) - ${label}`,
        });
      } catch { /* history is best-effort; the tick itself already saved */ }
      const db = createServiceClient();
      await db
        .from("helm_requests")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", id);
    }
    return NextResponse.json({ ok: true, fu: pipeline.fu });
  }

  // ── Original actions (compose/send/log) need the Gmail thread ──────────
  if (!r.gmail_thread_id) {
    return NextResponse.json({ error: "Send the proposal first - a follow-up replies in that email thread." }, { status: 400 });
  }

  // Follow-up number = (prior logged follow-ups) + 1. No schema change needed.
  const msgs = await getMessages(id);
  const priorFollowups = msgs.filter(
    (m) => m.direction === "outbound" && (m.body ?? "").startsWith(FOLLOWUP_TAG),
  ).length;
  const followupNumber = priorFollowups + 1;

  const { salutation, isAgent } = helmSalutation(r);

  // ---- LOG: George followed up himself (a call, WhatsApp, an email he wrote by
  // hand) and just wants it on the record. One button. Records the follow-up so
  // the count and the history are right, and pushes the next reminder out 5 days
  // so the daily cron nudges him again only when the NEXT one is due. No email is
  // sent - this only writes what already happened. ----
  if (action === "log") {
    const HOW: Record<string, string> = {
      call: "phone call", whatsapp: "WhatsApp", email: "email",
      person: "in person", other: "follow-up",
    };
    const how = HOW[(body?.how ?? "").toString()] || "follow-up";
    const note = (body?.note ?? "").toString().trim();
    const line = `[Follow-up ${followupNumber}] (logged by hand · ${how})${note ? `\n\n${note}` : ""}`;
    try {
      await logHelmMessage(id, { direction: "outbound", channel: "note", body: line });
      // Plan-aware (2026-07-24): when the 3-step plan exists, a hand-logged
      // follow-up ticks the first not-done step and the reminder moves to
      // the next planned date. Without a plan, the old flat +5 days stands.
      const pipeline = readPipeline(r.extraction);
      let nextDue: string | null;
      if (pipeline.fu?.length === 3 && pipeline.fu.some((s) => !s.done_at)) {
        const idx = pipeline.fu.findIndex((s) => !s.done_at);
        pipeline.fu[idx] = { ...pipeline.fu[idx], done_at: new Date().toISOString(), how };
        await mergePipeline(id, { fu: pipeline.fu }, { syncFollowUpAt: true });
        nextDue = nextDueTimestamp(pipeline.fu);
        const db = createServiceClient();
        await db
          .from("helm_requests")
          .update({ last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", id);
      } else {
        nextDue = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
        const db = createServiceClient();
        await db
          .from("helm_requests")
          .update({ follow_up_at: nextDue, last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", id);
      }
      return NextResponse.json({ ok: true, logged: 1, followupNumber, nextDue });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ---- GENERATE: compose an editable draft (no send, no DB write) ----
  if (action === "generate") {
    try {
      const draft = await composeFollowUp({
        salutation,
        agent: isAgent,
        followupNumber,
        occasion: r.occasion || undefined,
        brief: r.brief || undefined,
        original_email: r.email_intro || undefined,
      });
      return NextResponse.json({ ok: true, body: draft.body, followupNumber });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ---- SEND: reply in the same thread to the same recipient. Explicit confirm only. ----
  if (action === "send") {
    const emailBody = (body?.body ?? "").toString().trim();
    const to = (r.client_email ?? "").toString().trim();
    if (!to) return NextResponse.json({ error: "No recipient email on this request." }, { status: 400 });
    if (!emailBody) return NextResponse.json({ error: "The follow-up body is empty - generate or write a draft first." }, { status: 400 });

    try {
      const sent = await sendHelmEmail({
        to,
        subject: r.email_subject || "Your Greek charter",
        body: emailBody,
        threadId: r.gmail_thread_id || undefined,
        inReplyTo: r.gmail_last_message_id || undefined,
      });
      await logHelmMessage(id, {
        direction: "outbound",
        channel: "email",
        body: `[Follow-up ${followupNumber}]\n\n${emailBody}`,
        gmail_message_id: sent.messageId,
      });
      // Keep the thread chain current. Plan-aware (2026-07-24): an emailed
      // follow-up ticks the first not-done step of the 3-step plan and the
      // reminder moves to the next planned date; without a plan, +5 days.
      const pipeline = readPipeline(r.extraction);
      let nextFollowUp: string | null;
      if (pipeline.fu?.length === 3 && pipeline.fu.some((s) => !s.done_at)) {
        const idx = pipeline.fu.findIndex((s) => !s.done_at);
        pipeline.fu[idx] = { ...pipeline.fu[idx], done_at: new Date().toISOString(), how: "email" };
        await mergePipeline(id, { fu: pipeline.fu });
        nextFollowUp = nextDueTimestamp(pipeline.fu);
      } else {
        nextFollowUp = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      }
      const db = createServiceClient();
      await db
        .from("helm_requests")
        .update({
          gmail_last_message_id: sent.messageId,
          follow_up_at: nextFollowUp,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      return NextResponse.json({ ok: true, sent: 1, followupNumber });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
