// POST /api/helm/:id/reply — respond to an incoming client/agent reply.
//   { action: "generate" }   -> draft a reply that answers their latest message
//   { action: "send", body } -> send it as a reply IN THE SAME Gmail thread
// Same recipient + thread as the proposal. Voice adapts to the request type.
// NEVER auto-sends; the UI requires an explicit confirm.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, getMessages, logHelmMessage } from "@/lib/helm-admin";
import { createServiceClient } from "@/lib/supabase-server";
import { helmSalutation } from "@/lib/helm/addressing";
import { composeReply } from "@/lib/helm/compose";
import { sendHelmEmail } from "@/lib/helm/gmail-send";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    return NextResponse.json({ error: "No proposal thread yet - send the proposal first." }, { status: 400 });
  }

  const msgs = await getMessages(id);
  const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound" && (m.body ?? "").trim());
  const { salutation, isAgent } = helmSalutation(r);

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "generate") {
    if (!lastInbound) {
      return NextResponse.json({ error: "No incoming reply to respond to yet. Check replies first." }, { status: 400 });
    }
    try {
      const draft = await composeReply({
        salutation,
        agent: isAgent,
        client_reply: lastInbound.body || "",
        brief: r.brief || undefined,
        original_email: r.email_intro || undefined,
      });
      return NextResponse.json({ ok: true, body: draft.body });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === "send") {
    const emailBody = (body?.body ?? "").toString().trim();
    const to = (r.client_email ?? "").toString().trim();
    if (!to) return NextResponse.json({ error: "No recipient email on this request." }, { status: 400 });
    if (!emailBody) return NextResponse.json({ error: "The reply body is empty - generate or write a draft first." }, { status: 400 });

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
        body: `[Reply]\n\n${emailBody}`,
        gmail_message_id: sent.messageId,
      });
      const db = createServiceClient();
      await db
        .from("helm_requests")
        .update({ gmail_last_message_id: sent.messageId, updated_at: new Date().toISOString() })
        .eq("id", id);
      return NextResponse.json({ ok: true, sent: 1 });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
