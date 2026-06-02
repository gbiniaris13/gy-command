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
import { getRequest, logHelmMessage } from "@/lib/helm-admin";
import { composeAgencyInquiry } from "@/lib/helm/compose";
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

type Req = {
  dates_from?: string | null;
  dates_to?: string | null;
  area?: string | null;
  party_size?: string | null;
  occasion?: string | null;
  budget?: string | null;
  special_requests?: string | null;
  central_agency_email?: string | null;
  client_email?: string | null;
  client_whatsapp?: string | null;
};

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
      });
      return NextResponse.json({ ok: true, subject: draft.subject, body: draft.body });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ---- SEND: to the central agency, logged. Never reached without explicit confirm. ----
  if (action === "send") {
    const subject = (body?.subject ?? "").toString().trim();
    let emailBody = (body?.body ?? "").toString().trim();
    const rawTo = (r.central_agency_email ?? "").toString().trim();

    if (!rawTo) return NextResponse.json({ error: "No central agency email on this request. Add it via Edit first." }, { status: 400 });
    if (!subject) return NextResponse.json({ error: "Add a subject before sending." }, { status: 400 });
    if (!emailBody) return NextResponse.json({ error: "The inquiry body is empty - generate or write a draft first." }, { status: 400 });

    const recipients = rawTo.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /.+@.+\..+/.test(s));
    if (!recipients.length) return NextResponse.json({ error: "No valid central agency email address found." }, { status: 400 });
    const to = recipients.join(", ");

    // Defense in depth: never let the client's own contact details leak to the supplier.
    for (const token of [r.client_email, r.client_whatsapp]) {
      const t = (token ?? "").toString().trim();
      if (t) emailBody = emailBody.split(t).join("my client");
    }

    try {
      const sent = await sendHelmEmail({ to, subject, body: emailBody });
      await logHelmMessage(id, {
        direction: "outbound",
        channel: "email",
        body: `[Central agency inquiry -> ${to}]\n\n${emailBody}`,
        gmail_message_id: sent.messageId,
      });
      return NextResponse.json({ ok: true, messageId: sent.messageId, to });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
