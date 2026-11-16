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
import { getRequest, getMessages, logHelmMessage, mergePipeline, mergeFollowup } from "@/lib/helm-admin";
import { createServiceClient } from "@/lib/supabase-server";
import { sendHelmEmail } from "@/lib/helm/gmail-send";
import { readPipeline, suggestFollowUps, replanKeepingHistory, nextDueTimestamp } from "@/lib/helm/pipeline";
import { readFollowupSettings, sanitizeSettingsPatch } from "@/lib/helm/followup/settings";
import { generateFollowUp, inboundSince, type HelmRow } from "@/lib/helm/followup/engine";
import { planGhosted, planNurture, clientTimezone } from "@/lib/helm/followup/calendar";
import { gmailFetch } from "@/lib/google-api";
import { readOutbox, writeOutbox, type OutboxItem } from "@/lib/helm/followup/outbox";

export const runtime = "nodejs";
export const maxDuration = 180; // Generate reads every thread, then the model may need a second pass (seen up to ~100 s)

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
  // PLAN-INIT builds a plan only when there is none. (Until 2026-08-04 the
  // guard was `length !== 3`, which silently rebuilt any plan that was not
  // exactly three steps long. Plans are now 1 to 6 steps, so that test would
  // have regenerated a healthy plan on every visit and thrown away George's
  // hand-edited dates.) Use plan-replan to rebuild on purpose.
  if (action === "plan-init" || action === "plan-replan") {
    const pipeline = readPipeline(r.extraction);
    const needsPlan = !pipeline.fu || pipeline.fu.length === 0;
    if (needsPlan || action === "plan-replan") {
      const sentAt = pipeline.sent_at || r.last_activity_at || new Date().toISOString();
      const fs = readFollowupSettings(r.extraction);
      const opts = { tz: fs.tz, phone: r.client_whatsapp ?? null, earlyBookingDeadline: fs.early_booking_deadline };
      pipeline.fu = needsPlan
        // Fresh request: the research cadence runs from the moment the proposal left.
        ? suggestFollowUps(sentAt, r.dates_from ?? null, opts)
        // Existing request: every tick George has earned is carried across
        // untouched, and only the steps still ahead are re-timed (2026-11-16:
        // on the research cadence, measured from the send, kept from today).
        : replanKeepingHistory(pipeline.fu, r.dates_from ?? null, undefined, { ...opts, sentAtIso: sentAt });
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
    if (!Number.isInteger(step) || step < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "bad step/date" }, { status: 400 });
    }
    const pipeline = readPipeline(r.extraction);
    if (!pipeline.fu || !pipeline.fu[step]) {
      return NextResponse.json({ error: "no plan on this request yet" }, { status: 400 });
    }
    // 16/11: a date George sets by hand is his decision; the automatic
    // re-plan from the conversation never moves it.
    pipeline.fu[step] = { ...pipeline.fu[step], due: date, manual: true };
    await mergePipeline(id, { fu: pipeline.fu }, { syncFollowUpAt: true });
    return NextResponse.json({ ok: true, fu: pipeline.fu });
  }

  // PLAN-DONE: "I actually followed up" (WhatsApp, call, anywhere) - one
  // click. Marks the step, writes the history line, and follow_up_at moves
  // to the next not-done step so the daily reminder stays truthful.
  if (action === "plan-done") {
    const step = Number(body?.step);
    const how = (body?.how ?? "").toString().slice(0, 40) || null;
    const touch = (body?.touch ?? "").toString().slice(0, 40) || undefined;
    const pipeline = readPipeline(r.extraction);
    if (!Number.isInteger(step) || step < 0 || !pipeline.fu || !pipeline.fu[step]) {
      return NextResponse.json({ error: "no plan/step" }, { status: 400 });
    }
    if (!pipeline.fu[step].done_at) {
      pipeline.fu[step] = { ...pipeline.fu[step], done_at: new Date().toISOString(), how, ...(touch ? { touch } : {}) };
      await mergePipeline(id, { fu: pipeline.fu }, { syncFollowUpAt: true });
      const label = pipeline.fu[step].kind === "bye"
        ? "final courtesy note"
        : pipeline.fu[step].kind === "reopen"
          ? "re-opening near the charter"
          : `follow-up ${step + 1}`;
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

  // ── 2026-11-16 FOLLOW-UP FACTS: time zone, real option expiry, real
  // early-booking deadline, extra addresses, the client's own date. Stored in
  // extraction.followup; the only source of "real urgency" for a draft. ────
  if (action === "fu-settings") {
    const patch = sanitizeSettingsPatch((body ?? {}) as Record<string, unknown>);
    const followup = await mergeFollowup(id, patch);
    return NextResponse.json({ ok: true, followup });
  }

  // ── 2026-11-16 THE PAIR: George sent the WhatsApp version of a follow-up
  // from his phone. Record it in the conversation (so the next Generate sees
  // it and the WhatsApp limits can be counted). It does not tick a plan step:
  // the email Send does that, one touch = email + WhatsApp. ──────────────
  if (action === "wa-sent") {
    const text = (body?.body ?? "").toString().trim().slice(0, 2000);
    if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
    await logHelmMessage(id, { direction: "outbound", channel: "whatsapp", body: text });
    try { await mergeFollowup(id, { whatsapp_ok: true }); } catch {}
    const tick = !!body?.tick; // a WhatsApp-only touch (no email today): tick the step too
    if (tick) {
      const pipeline = readPipeline(r.extraction);
      const idx = (pipeline.fu ?? []).findIndex((s) => !s.done_at);
      if (idx >= 0) {
        pipeline.fu![idx] = { ...pipeline.fu![idx], done_at: new Date().toISOString(), how: "whatsapp", ...(typeof body?.touch_type === "string" ? { touch: body.touch_type.slice(0, 40) } : {}) };
        await mergePipeline(id, { fu: pipeline.fu }, { syncFollowUpAt: true });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ── 16/11 SEND ON WHATSAPP: one click puts one message in the outbox; the
  // WhatsApp app on George's MacBook sends it within ~20 s and confirms from
  // its own database (see /api/helm/wa-outbox). Never retried by itself.
  if (action === "wa-queue") {
    const text = (body?.text ?? "").toString().trim().slice(0, 1500);
    const phone = (r.client_whatsapp ?? "").replace(/\D/g, "");
    if (!text) return NextResponse.json({ error: "Το μήνυμα είναι άδειο." }, { status: 400 });
    if (phone.length < 8) return NextResponse.json({ error: "Δεν υπάρχει τηλέφωνο σε αυτό το αίτημα." }, { status: 400 });
    const items = await readOutbox();
    // A second click on the same text within 10 minutes is the same message.
    const dup = items.find((i) => i.request_id === id && i.text === text && Date.now() - Date.parse(i.created_at) < 10 * 60000 && i.status !== "failed");
    if (dup) return NextResponse.json({ ok: true, id: dup.id, status: dup.status });
    const isAgent = r.request_type === "travel_agent";
    const year = (r.dates_from ?? "").slice(0, 4) || String(new Date().getFullYear() + 1);
    const surname = (r.client_surname || "").trim();
    const first = (r.client_name || "").replace(/^(mr|mrs|ms|dr)\.?\s+/i, "").split(/\s+/)[0] || surname || "Client";
    const item: OutboxItem = {
      id: crypto.randomUUID(), request_id: id, phone, text,
      first_name: first,
      last_name: `${surname && surname.toLowerCase() !== first.toLowerCase() ? surname + " " : ""}GY ${isAgent ? "agent" : "client"} ${year}`,
      org: isAgent ? "George Yachts B2B" : "George Yachts client",
      note: `${r.area ?? ""} ${r.dates_from ?? ""} · Added from The Helm, ${new Date().toISOString().slice(0, 10)}`.trim(),
      created_at: new Date().toISOString(), status: "queued",
    };
    await writeOutbox([...items, item]);
    return NextResponse.json({ ok: true, id: item.id, status: item.status });
  }
  if (action === "wa-status") {
    const it = (await readOutbox()).find((i) => i.id === body?.id);
    return NextResponse.json({ ok: true, status: it?.status ?? "unknown", detail: it?.detail ?? "" });
  }

  // ── 2026-11-16 GENERATE (research engine). Reads Gmail by address (every
  // thread), the pasted WhatsApp and the Helm notes, computes dates and
  // windows in code, writes with the playbook in SKILL.md, checks in code.
  // Writes nothing to the client. Saves the draft on the request only so the
  // "what George changes" report can compare it with what he sent. ─────────
  if (action === "generate") {
    try {
      const msgs0 = await getMessages(id);
      const result = await generateFollowUp(r as unknown as HelmRow, msgs0, {
        differentAngle: typeof body?.different_from === "string" ? body.different_from.slice(0, 600) : undefined,
      });
      try {
        await mergeFollowup(id, {
          last_gen: {
            at: result.generated_at, model: result.model, scenario: result.scenario_code,
            touch_type: result.next_touch.touch_type, channel: result.next_touch.channel,
            subject: result.next_touch.subject, body: (result.next_touch.body ?? "").slice(0, 3000),
          },
        });
      } catch { /* the draft still shows; only the comparison record is lost */ }
      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ── Original actions (send/log) need the Gmail thread ──────────
  if (!r.gmail_thread_id && !(action === "send" && typeof body?.thread_id === "string" && body.thread_id)) {
    return NextResponse.json({ error: "Send the proposal first - a follow-up replies in that email thread." }, { status: 400 });
  }

  // Follow-up number = (prior logged follow-ups) + 1. No schema change needed.
  const msgs = await getMessages(id);
  const priorFollowups = msgs.filter(
    (m) => m.direction === "outbound" && (m.body ?? "").startsWith(FOLLOWUP_TAG),
  ).length;
  const followupNumber = priorFollowups + 1;


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
      // Plan-aware (2026-07-24, generalised 2026-08-04): when a plan exists of
      // ANY length, a hand-logged
      // follow-up ticks the first not-done step and the reminder moves to
      // the next planned date. Without a plan, the old flat +5 days stands.
      const pipeline = readPipeline(r.extraction);
      let nextDue: string | null;
      if (pipeline.fu?.length && pipeline.fu.some((s) => !s.done_at)) {
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

  // ---- SEND: George pressed Send. Explicit confirm only. ----
  // 2026-11-16: replies in the client's NEWEST thread (the one Generate read),
  // with the real Message-ID in In-Reply-To so Apple Mail and Outlook thread it
  // too; or, if George chose it, as a fresh email with the new subject. Refuses
  // if the client wrote after the draft was made (guardrail 2). Records what
  // went out on the plan step, and re-times the rest of the plan when the
  // conversation has changed shape (ghosted → +2/+5/+10/+20/+35, close → nurture).
  if (action === "send") {
    const emailBody = (body?.body ?? "").toString().trim();
    const to = (r.client_email ?? "").toString().trim();
    if (!to) return NextResponse.json({ error: "No recipient email on this request." }, { status: 400 });
    if (!emailBody) return NextResponse.json({ error: "The follow-up box is empty. Write the note, or draft one, then send." }, { status: 400 });

    const generatedAt = typeof body?.generated_at === "string" ? body.generated_at : null;
    if (generatedAt && !body?.force) {
      try {
        if (await inboundSince(r as unknown as HelmRow, generatedAt)) {
          return NextResponse.json({ error: "Ο πελάτης έγραψε μετά το πρόχειρο. Πάτα ξανά Generate για να το λάβει υπόψη.", code: "inbound-since" }, { status: 409 });
        }
      } catch { /* Gmail unreachable: do not block George's own send */ }
    }

    const threadId = (typeof body?.thread_id === "string" && body.thread_id) || r.gmail_thread_id || undefined;
    const newSubject = (body?.subject ?? "").toString().trim();
    const asNewEmail = !!body?.as_new_email && !!newSubject;
    let subject = r.email_subject || "Your Greek charter";
    let inReplyTo: string | undefined = r.gmail_last_message_id || undefined;
    if (!asNewEmail && threadId) {
      try {
        const t = await gmailFetch(`/threads/${threadId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject`);
        if (t.ok) {
          const th = (await t.json()) as { messages?: { payload?: { headers?: { name: string; value: string }[] } }[] };
          const hs = (m?: { payload?: { headers?: { name: string; value: string }[] } }, n?: string) =>
            m?.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value;
          const first = th.messages?.[0];
          const last = th.messages?.[th.messages.length - 1];
          const subj = hs(first, "subject");
          if (subj) subject = /^re:/i.test(subj) ? subj : `Re: ${subj}`;
          inReplyTo = hs(last, "message-id") || inReplyTo;
        }
      } catch { /* fall back to the stored subject/id */ }
    }

    try {
      const sent = await sendHelmEmail({ utm: { source: "helm", campaign: "follow-up" },
        to,
        subject: asNewEmail ? newSubject : subject,
        body: emailBody,
        threadId: asNewEmail ? undefined : threadId,
        inReplyTo: asNewEmail ? undefined : inReplyTo,
      });
      await logHelmMessage(id, {
        direction: "outbound",
        channel: "email",
        body: `[Follow-up ${followupNumber}]\n\n${emailBody}`,
        gmail_message_id: sent.messageId,
      });

      const touch = typeof body?.touch_type === "string" ? body.touch_type.slice(0, 40) : undefined;
      const scenario = typeof body?.scenario_code === "string" ? body.scenario_code : "";
      const draftBody = typeof body?.draft_body === "string" ? body.draft_body : null;
      const ai: "ai" | "ai_edited" | "manual" = draftBody === null ? "manual" : draftBody.trim() === emailBody ? "ai" : "ai_edited";
      const pipeline = readPipeline(r.extraction);
      const nowIso = new Date().toISOString();
      const stepDone = { done_at: nowIso, how: "email", ...(touch ? { touch } : {}), subject: asNewEmail ? newSubject : subject, ai };
      let fu = pipeline.fu ?? [];
      if (fu.some((s) => !s.done_at)) {
        const idx = fu.findIndex((s) => !s.done_at);
        fu[idx] = { ...fu[idx], ...stepDone };
      } else {
        fu = [...fu, { due: nowIso.slice(0, 10), kind: "nudge", v: 2, ...stepDone }];
      }
      const fs = readFollowupSettings(r.extraction);
      const { tz } = clientTimezone(fs.tz, r.client_whatsapp ?? null);
      const lastIn = typeof body?.last_inbound_at === "string" ? body.last_inbound_at : null;
      const done = fu.filter((s) => s.done_at);
      if (scenario === "S9" || touch === "permission_to_close") {
        fu = [...done, ...planNurture(nowIso, tz)];
      } else if (["S2", "S3", "S4", "S5", "S7"].includes(scenario)) {
        // Ghosted: the +2/+5/+10/+20/+35 ladder runs from the client's last
        // word. After answering an engaged client, it runs from our reply.
        fu = [...done, ...planGhosted(scenario === "S7" && lastIn ? lastIn : nowIso, tz, nowIso)];
      }
      await mergePipeline(id, { fu });
      const nextFollowUp = nextDueTimestamp(fu);
      const db = createServiceClient();
      await db
        .from("helm_requests")
        .update({
          gmail_last_message_id: sent.messageId,
          follow_up_at: nextFollowUp,
          updated_at: nowIso,
        })
        .eq("id", id);
      try { await mergeFollowup(id, { last_sent: { at: nowIso, ai, touch_type: touch ?? null, scenario, final_body: emailBody.slice(0, 3000) } }); } catch {}
      return NextResponse.json({ ok: true, sent: 1, followupNumber, next: nextFollowUp });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
