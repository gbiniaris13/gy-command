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
import { getRequest, getMessages, logHelmMessage } from "@/lib/helm-admin";
import { createServiceClient } from "@/lib/supabase-server";
import { helmSalutation } from "@/lib/helm/addressing";
import { composeFollowUp } from "@/lib/helm/compose";
import { sendHelmEmail } from "@/lib/helm/gmail-send";

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

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

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
      const nextDue = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      const db = createServiceClient();
      await db
        .from("helm_requests")
        .update({ follow_up_at: nextDue, last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id);
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
      // Keep the thread chain current and push the reminder out so the daily
      // helm-followup cron nudges George again only when the NEXT one is due.
      const db = createServiceClient();
      await db
        .from("helm_requests")
        .update({
          gmail_last_message_id: sent.messageId,
          follow_up_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
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
