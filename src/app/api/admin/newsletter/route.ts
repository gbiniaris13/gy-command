// v3 Pillar 4 — Newsletter management endpoints.
//
// Single mounting point for the newsletter CRUD + actions:
//
//   GET  /api/admin/newsletter                   list campaigns
//   POST /api/admin/newsletter                   create draft
//        body: { stream, subject?, body_markdown?, audience_definition?,
//                ai_brief?, generate_with_ai? }
//   POST /api/admin/newsletter?action=preview-audience
//        body: { audience_definition }
//   POST /api/admin/newsletter?action=compose
//        body: { stream, brief?, context? }
//   POST /api/admin/newsletter?action=test-send&id=<uuid>
//        body: { recipients: ["george@georgeyachts.com"] }
//   POST /api/admin/newsletter?action=send&id=<uuid>
//        body: { confirm: true }

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import {
  resolveAudience,
  composeCampaign,
  markdownToHtml,
  unsubscribeFooter,
  DEFAULT_AUDIENCE,
  type Stream,
  type AudienceFilter,
} from "@/lib/newsletter";

export const runtime = "nodejs";
export const maxDuration = 300;

const SELF = "george@georgeyachts.com";

function unsubscribeUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://command.georgeyachts.com";
  return `${base}/api/newsletter/unsubscribe?token=${token}`;
}

function buildRawDraft(args: {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}): string {
  const boundary = "gy_newsletter_" + Date.now();
  const lines = [
    `To: ${args.to}`,
    `From: George Yachts <${SELF}>`,
    `Subject: ${args.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    args.bodyText,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    args.bodyHtml,
    ``,
    `--${boundary}--`,
    ``,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

async function createGmailDraft(args: {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}): Promise<{ id: string } | null> {
  const raw = buildRawDraft(args);
  const res = await gmailFetch("/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { id: string };
  return { id: j.id };
}

async function sendGmailDraft(draftId: string): Promise<{
  ok: boolean;
  message_id?: string;
  error?: string;
}> {
  const res = await gmailFetch("/drafts/send", {
    method: "POST",
    body: JSON.stringify({ id: draftId }),
  });
  if (!res.ok) return { ok: false, error: `gmail send failed (${res.status})` };
  const j = (await res.json()) as { id?: string; threadId?: string };
  return { ok: true, message_id: j.id };
}

function newToken(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 14)
  );
}

// ─── GET — list campaigns ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sb = createServiceClient();
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const { data: c, error } = await sb
      .from("newsletter_campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { data: sends } = await sb
      .from("newsletter_sends")
      .select("status")
      .eq("campaign_id", id);
    type S = { status: string };
    const counts: Record<string, number> = {};
    for (const s of (sends ?? []) as S[])
      counts[s.status] = (counts[s.status] ?? 0) + 1;
    return NextResponse.json({ ok: true, campaign: c, send_counts: counts });
  }

  const { data, error } = await sb
    .from("newsletter_campaigns")
    .select("id, stream, subject, status, audience_size, scheduled_for, sent_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, campaigns: data ?? [] });
}

// ─── POST — actions + create ───────────────────────────────────────

export async function POST(req: NextRequest) {
  const sb = createServiceClient();
  const action = req.nextUrl.searchParams.get("action");
  const id = req.nextUrl.searchParams.get("id");

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // ── action: preview-audience ─────────────────────────────────────
  if (action === "preview-audience") {
    const filter = (body.audience_definition as AudienceFilter) ?? DEFAULT_AUDIENCE;
    const members = await resolveAudience(sb, filter);
    return NextResponse.json({
      ok: true,
      audience_size: members.length,
      sample: members.slice(0, 25),
    });
  }

  // ── action: compose (AI) ─────────────────────────────────────────
  if (action === "compose") {
    const stream = (body.stream as Stream) ?? "general";
    const composed = await composeCampaign({
      stream,
      brief: typeof body.brief === "string" ? body.brief : undefined,
      context: typeof body.context === "string" ? body.context : undefined,
    });
    return NextResponse.json({ ok: true, ...composed });
  }

  // ── action: test-send ────────────────────────────────────────────
  if (action === "test-send") {
    if (!id) return NextResponse.json({ error: "?id required" }, { status: 400 });
    const recipients = Array.isArray(body.recipients)
      ? (body.recipients as string[])
      : [SELF];
    const { data: c } = await sb
      .from("newsletter_campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!c) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

    const html = c.body_html ?? markdownToHtml(c.body_markdown ?? "");
    const text = (c.body_markdown ?? "") +
      unsubscribeFooter(unsubscribeUrl("test"));
    const htmlWithFooter = html +
      `<p style="font-size:11px;color:#888;margin-top:24px">[TEST SEND] You're receiving this as a preview. <a href="${unsubscribeUrl("test")}">Unsubscribe</a></p>`;

    const results: { to: string; ok: boolean; message_id?: string; error?: string }[] = [];
    for (const to of recipients) {
      const draft = await createGmailDraft({
        to,
        subject: `[TEST] ${c.subject}`,
        bodyHtml: htmlWithFooter,
        bodyText: text,
      });
      if (!draft) {
        results.push({ to, ok: false, error: "draft creation failed" });
        continue;
      }
      const sent = await sendGmailDraft(draft.id);
      results.push({ to, ok: sent.ok, message_id: sent.message_id, error: sent.error });
    }

    await sb
      .from("newsletter_campaigns")
      .update({
        status: "test_sent",
        test_sent_to: recipients.join(","),
        test_sent_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json({ ok: true, results });
  }

  // ── action: send (to full audience) ──────────────────────────────
  if (action === "send") {
    if (!id) return NextResponse.json({ error: "?id required" }, { status: 400 });
    if (body.confirm !== true) {
      return NextResponse.json(
        { error: "Pass { confirm: true } to acknowledge this is a real send." },
        { status: 400 },
      );
    }
    const { data: c } = await sb
      .from("newsletter_campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!c) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    if (c.status === "sent" || c.status === "sending") {
      return NextResponse.json(
        { error: `campaign is already ${c.status}` },
        { status: 409 },
      );
    }

    await sb
      .from("newsletter_campaigns")
      .update({ status: "sending" })
      .eq("id", id);

    const filter = (c.audience_definition as AudienceFilter) ?? DEFAULT_AUDIENCE;
    const audience = await resolveAudience(sb, filter);
    let drafted = 0;
    let sent = 0;
    let failed = 0;
    const startedAt = Date.now();
    const budgetMs = 250_000;

    for (const m of audience) {
      if (Date.now() - startedAt > budgetMs) {
        // Hand off to a re-invocation; remaining recipients will still
        // be picked up because we skip rows where send already exists.
        break;
      }
      // Idempotency — skip if already drafted/sent for this campaign.
      const { data: existing } = await sb
        .from("newsletter_sends")
        .select("id, status")
        .eq("campaign_id", id)
        .eq("recipient_email", m.email)
        .maybeSingle();
      if (existing && (existing.status === "sent" || existing.status === "drafted")) {
        continue;
      }

      const token = newToken();
      const personalisedMd = (c.body_markdown ?? "").replace(
        /\{first_name\}/g,
        m.first_name ?? "there",
      );
      const html =
        markdownToHtml(personalisedMd) +
        `<p style="font-size:11px;color:#888;margin-top:24px"><a href="${unsubscribeUrl(token)}">Unsubscribe</a></p>`;
      const text = personalisedMd + unsubscribeFooter(unsubscribeUrl(token));

      const draft = await createGmailDraft({
        to: m.email,
        subject: c.subject,
        bodyHtml: html,
        bodyText: text,
      });
      if (!draft) {
        failed += 1;
        await sb.from("newsletter_sends").upsert(
          {
            campaign_id: id,
            contact_id: m.contact_id,
            recipient_email: m.email,
            status: "failed",
            failure_reason: "draft creation failed",
            unsubscribe_token: token,
          },
          { onConflict: "campaign_id,recipient_email" },
        );
        continue;
      }
      drafted += 1;

      const fired = await sendGmailDraft(draft.id);
      if (!fired.ok) {
        await sb.from("newsletter_sends").upsert(
          {
            campaign_id: id,
            contact_id: m.contact_id,
            recipient_email: m.email,
            status: "failed",
            gmail_draft_id: draft.id,
            failure_reason: fired.error,
            unsubscribe_token: token,
          },
          { onConflict: "campaign_id,recipient_email" },
        );
        failed += 1;
        continue;
      }

      await sb.from("newsletter_sends").upsert(
        {
          campaign_id: id,
          contact_id: m.contact_id,
          recipient_email: m.email,
          status: "sent",
          gmail_draft_id: draft.id,
          gmail_message_id: fired.message_id,
          drafted_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          unsubscribe_token: token,
        },
        { onConflict: "campaign_id,recipient_email" },
      );
      sent += 1;
    }

    // Mark sent only when the run actually exhausted the audience.
    const { count } = await sb
      .from("newsletter_sends")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id)
      .in("status", ["sent", "drafted"]);
    const audienceSize = audience.length;
    const finalStatus =
      (count ?? 0) >= audienceSize ? "sent" : "sending";
    await sb
      .from("newsletter_campaigns")
      .update({
        status: finalStatus,
        sent_at: finalStatus === "sent" ? new Date().toISOString() : null,
      })
      .eq("id", id);

    return NextResponse.json({
      ok: true,
      audience_size: audienceSize,
      drafted,
      sent,
      failed,
      status: finalStatus,
      hint:
        finalStatus === "sending"
          ? "Time budget reached — re-invoke ?action=send to continue."
          : "Send complete.",
    });
  }

  // ── default: create a campaign ───────────────────────────────────
  const stream: Stream = (body.stream as Stream) ?? "general";
  let subject = (body.subject as string) ?? null;
  let bodyMarkdown = (body.body_markdown as string) ?? null;
  const audienceDef =
    (body.audience_definition as AudienceFilter) ?? DEFAULT_AUDIENCE;
  let aiGenerated = false;
  let aiModel: string | null = null;

  if (body.generate_with_ai === true || (!subject && !bodyMarkdown)) {
    const composed = await composeCampaign({
      stream,
      brief: typeof body.ai_brief === "string" ? body.ai_brief : undefined,
    });
    subject = composed.subject;
    bodyMarkdown = composed.body_markdown;
    aiGenerated = true;
    aiModel = composed.ai_model_used;
  }

  const audience = await resolveAudience(sb, audienceDef);
  const audienceSize = audience.length;

  const html = markdownToHtml(bodyMarkdown ?? "");

  const { data: inserted, error: insertErr } = await sb
    .from("newsletter_campaigns")
    .insert({
      stream,
      subject: subject ?? "Untitled draft",
      body_markdown: bodyMarkdown,
      body_html: html,
      audience_definition: audienceDef,
      audience_size: audienceSize,
      status: "draft",
      ai_generated: aiGenerated,
      ai_model_used: aiModel,
      created_by: SELF,
    })
    .select("*")
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    campaign: inserted,
    audience_size: audienceSize,
  });
}
