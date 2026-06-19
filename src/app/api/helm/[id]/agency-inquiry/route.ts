// POST /api/helm/:id/agency-inquiry — broker-to-supplier inquiry to the central
// agency. Two actions:
//   { action: "generate" }            -> compose an editable draft (no send, no write)
//   { action: "send", subject, body } -> send to central_agency_email via Gmail, log it
// Full George Yachts identity (NOT white-label, NOT the client proposal). The end
// client is kept anonymous to the supplier. NEVER auto-sends: the UI requires an
// explicit confirm, and this route only sends on action "send".

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, getMessages, logHelmMessage } from "@/lib/helm-admin";
import { composeAgencyInquiry } from "@/lib/helm/compose";
import { sendHelmEmail } from "@/lib/helm/gmail-send";
import { resolveAgencyRecipients } from "@/lib/helm/recipients";
import { agencyAlreadySent, splitNewVsSent } from "@/lib/helm/agency";

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

type Req = {
  dates_from?: string | null;
  dates_to?: string | null;
  area?: string | null;
  party_size?: string | null;
  occasion?: string | null;
  budget?: string | null;
  special_requests?: string | null;
  brief?: string | null;
  central_agency_email?: string | null;
  supplier_raw?: string | null;
  client_email?: string | null;
  client_whatsapp?: string | null;
  client_name?: string | null;
  client_surname?: string | null;
};

// Defense in depth: strip the client's own identity (name, surname, email,
// phone) from any supplier-bound text. The composer is already instructed never
// to include them; this guarantees it even if a name was written in the brief.
function scrubClient(body: string, r: Req): string {
  let out = body;
  for (const tok of [r.client_email, r.client_whatsapp, r.client_name, r.client_surname]) {
    const t = (tok ?? "").toString().trim();
    if (t.length >= 3) out = out.split(t).join("my client");
  }
  return out;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function buildDates(r: Req): string {
  const from = fmtDate(r.dates_from);
  const to = fmtDate(r.dates_to);
  if (from && to) return `${from} - ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return "";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = (await getRequest(id)) as Req | null;
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  // ---- GENERATE: compose an editable draft (no send, no DB write) ----
  if (action === "generate") {
    try {
      const draft = await composeAgencyInquiry({
        area: r.area || undefined,
        party_size: r.party_size || undefined,
        budget: r.budget || undefined,
        dates: buildDates(r) || undefined,
        occasion: r.occasion || undefined,
        special_requests: r.special_requests || undefined,
        details: r.brief || undefined,
      });
      return NextResponse.json({ ok: true, subject: draft.subject, body: scrubClient(draft.body, r) });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ---- SEND: to the central agency, logged. Never reached without explicit confirm. ----
  if (action === "send") {
    const subject = (body?.subject ?? "").toString().trim();
    let emailBody = (body?.body ?? "").toString().trim();

    // Recipients: the dedicated central_agency_email field wins; otherwise the
    // emails pasted in the Supplier source box. Client's email is always excluded.
    const recipients = resolveAgencyRecipients(r.central_agency_email, r.supplier_raw, r.client_email);
    if (!recipients.length) return NextResponse.json({ error: "No central agency email found. Add the agency email(s) in the Supplier source box above, or via Edit." }, { status: 400 });
    if (!subject) return NextResponse.json({ error: "Add a subject before sending." }, { status: 400 });
    if (!emailBody) return NextResponse.json({ error: "The inquiry body is empty - generate or write a draft first." }, { status: 400 });

    // NEVER re-email an agency that already received this inquiry. We re-read the
    // log fresh here (source of truth) and send ONLY to agencies not yet
    // contacted — unless the operator explicitly chose "resend to everyone".
    const resendAll = body?.resend_all === true;
    const alreadySent = agencyAlreadySent(await getMessages(id));
    const { fresh, skipped } = splitNewVsSent(recipients, alreadySent);
    const targets = resendAll ? recipients : fresh;

    if (!targets.length) {
      return NextResponse.json({ ok: true, sent: 0, skipped: skipped.length, to: [], message: "Every agency in the list has already received this inquiry. Nothing was re-sent." });
    }

    // Defense in depth: never let the client's own identity leak to the supplier.
    emailBody = scrubClient(emailBody, r);

    try {
      // CRITICAL: send ONE SEPARATE email per agency, each addressed only to
      // that recipient. Central agencies are competing suppliers and must NEVER
      // see one another (no shared To, no CC, no BCC batching).
      const messageIds: string[] = [];
      for (const rcpt of targets) {
        const sent = await sendHelmEmail({ to: rcpt, subject, body: emailBody });
        messageIds.push(sent.messageId);
      }
      await logHelmMessage(id, {
        direction: "outbound",
        channel: "email",
        body: `[Central agency inquiry -> ${targets.join(", ")} - sent individually, one separate email each]\n\n${emailBody}`,
        gmail_message_id: messageIds[0] ?? null,
      });
      return NextResponse.json({ ok: true, sent: targets.length, to: targets, skipped: resendAll ? 0 : skipped.length, skippedTo: resendAll ? [] : skipped });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
