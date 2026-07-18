// POST /api/helm/:id/send — send the proposal email (with the generated PDF
// attached) via Gmail. Triggered ONLY by George's explicit confirm in the UI;
// never auto-sends. Threads the message, logs an outbound helm_message,
// advances the request to Sent, and sets follow_up_at = now + 4 days.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, markRequestSent, logHelmMessage } from "@/lib/helm-admin";
import { subjectWithRef } from "@/lib/helm/refcode";
import { proposalToken } from "@/lib/helm/proposal-token";
import { downloadProposalPdf } from "@/lib/helm/storage";
import { sendHelmEmail } from "@/lib/helm/gmail-send";
import { PARTNERSHIP_PDF_BASE64, PARTNERSHIP_PDF_FILENAME } from "@/lib/helm/partnership-pdf.generated";
import { addSubscribers } from "@/lib/newsletter-proxy";

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

  const body = await req.json().catch(() => ({}));
  // The GY ref rides on the client/agent subject too (George 2026-07-17), and
  // it must survive any manual edit of the subject line — re-applied here,
  // idempotently, right before the email actually goes out.
  const subject = subjectWithRef((body?.subject ?? r.email_subject ?? "").trim(), r.created_at);
  const emailBody = (body?.body ?? r.email_intro ?? "").trim();
  const to = (r.client_email ?? "").trim();

  // Guards (server-side; the UI also disables the button).
  if (!to) return NextResponse.json({ error: "No client email on this request — add one before sending." }, { status: 400 });
  if (!r.proposal_pdf_path) return NextResponse.json({ error: "Generate the proposal PDF before sending." }, { status: 400 });
  if (!emailBody) return NextResponse.json({ error: "The email body is empty — write/approve a draft first." }, { status: 400 });

  try {
    const isAgent = r.request_type === "travel_agent";
    type Att = { filename: string; mimeType: string; base64: string };
    const attachments: Att[] = [];
    let finalBody = emailBody;

    if (isAgent) {
      // Travel agents get the WHITE-LABEL proposal PDF to forward, plus the
      // partnership / commission program PDF. (Agents don't get the
      // George-branded magazine.)
      const pdf = await downloadProposalPdf(r.proposal_pdf_path);
      attachments.push({ filename: "Charter_Proposal.pdf", mimeType: "application/pdf", base64: Buffer.from(pdf).toString("base64") });
      attachments.push({ filename: PARTNERSHIP_PDF_FILENAME, mimeType: "application/pdf", base64: PARTNERSHIP_PDF_BASE64 });
    } else {
      // Direct client: NO PDF, ever (George 2026-07-18 — "το PDF το βγάζεις
      // τελείως"). The private online magazine is the whole deliverable and it
      // travels as a LINK. Guarantee the link is in the body even after George
      // rewrites the AI draft by hand — he only ever presses Send.
      // Always the clean custom domain for a CLIENT link, never the raw
      // *.vercel.app origin George may be browsing from (2026-07-18).
      const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://command.georgeyachts.com";
      const salonUrl = `${origin}/p/${proposalToken(id)}`;
      if (!finalBody.includes("/p/")) {
        finalBody = `${finalBody.replace(/\s+$/, "")}\n\nYour private selection, with the photographs and everything in one place:\n${salonUrl}`;
      }
    }

    const sent = await sendHelmEmail({
      to,
      subject: subject || "Your Greek charter",
      body: finalBody,
      threadId: r.gmail_thread_id || undefined,
      inReplyTo: r.gmail_last_message_id || undefined,
      attachments,
    });

    await markRequestSent(id, {
      gmail_thread_id: sent.threadId,
      gmail_last_message_id: sent.messageId,
      email_subject: subject || "Your Greek charter",
      email_intro: finalBody,
    });
    await logHelmMessage(id, {
      direction: "outbound",
      channel: "email",
      body: finalBody,
      gmail_message_id: sent.messageId,
    });

    // Auto-grow the newsletter audience from every proposal we actually send:
    // a DIRECT CLIENT → "bridge" (clients), a TRAVEL AGENT → "wake" (the agent's
    // own email is in client_email for travel_agent). Best-effort — it never
    // blocks or fails the send, and the proxy de-dupes + records consent source.
    // send_welcome is OFF so we don't fire a second email on top of the proposal.
    let newsletterSync: { ok: boolean; stream: string; added?: number; error?: string } | null = null;
    try {
      const stream = isAgent ? "wake" : "bridge";
      const res = await addSubscribers({ stream, emails: [to], source: "helm_request", send_welcome: false });
      newsletterSync = { ok: true, stream, added: res.added };
    } catch (e) {
      newsletterSync = { ok: false, stream: isAgent ? "wake" : "bridge", error: (e as Error).message };
      console.warn("[helm/send] newsletter auto-add failed:", (e as Error).message);
    }

    return NextResponse.json({ ok: true, messageId: sent.messageId, threadId: sent.threadId, newsletterSync });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
