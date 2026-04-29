// v3 Pillar 7 — Daily charter lifecycle firing.
//
// Runs every morning ~06:30 Athens. For every charter_lifecycle_milestone
// whose due_date <= today (Athens) AND status = 'pending', generate a
// Gmail draft using the personalized template and write back gmail_draft_id.
//
// Auto-DRAFTS only — never auto-sends. Matches the rest of the codebase
// (greetings, commitments). George reviews drafts before pressing send.
//
// Idempotent — milestones already linked to a gmail_draft_id are skipped.
//
// Resilient — if the v3 schema isn't applied yet (table missing), the
// route returns a graceful 200 with hint instead of crashing the cron.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import {
  generateMilestoneDraft,
  type TemplateContext,
} from "@/lib/charter-lifecycle";
import { observeCron } from "@/lib/cron-observer";

export const runtime = "nodejs";
export const maxDuration = 300;

interface MilestoneRow {
  id: string;
  deal_id: string | null;
  contact_id: string | null;
  milestone_type: string;
  due_date: string;
  status: string;
  auto_action: string | null;
  gmail_draft_id: string | null;
}

interface DealRow {
  id: string;
  primary_contact_id: string | null;
  vessel_name: string | null;
  charter_start_date: string | null;
  charter_end_date: string | null;
  embark_port: string | null;
  disembark_port: string | null;
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

// Map milestone_type → template key in charter-lifecycle.ts.
// Milestones without a template (research-only ones like T-60, T-21) are
// recorded but no draft is generated — George sees them in the cockpit
// for awareness.
const TEMPLATE_KEY: Record<string, string | null> = {
  "T-60": null,
  "T-45": "T-45_reference_list",
  "T-40": "T-40_send_references",
  "T-30": "T-30_pif_and_captain_call",
  "T-21": null,
  "T-15": null,
  "T-14": "T-14_personal_video",
  "T-7": "T-7_final_logistics",
  "T-3": "T-3_looking_forward",
  "T-1": null,
  "T+0": "T+0_embarkation",
  "T+midpoint": "T+midpoint_checkin",
  "T+disembark+1": "T+disembark+1_thank_you",
  "T+7": "T+7_testimonial",
  "T+30": "T+30_settled",
  "T+90": "T+90_next_season",
  "T+annual": "T+annual_anniversary",
};

function todayAthens(): string {
  const now = new Date();
  // +2h winter / +3h summer; use +2 as conservative floor.
  const athens = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return athens.toISOString().slice(0, 10);
}

function buildRawDraft(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

async function getOrCreateLabelId(name: string): Promise<string | null> {
  try {
    const list = await gmailFetch("/labels");
    if (!list.ok) return null;
    const j = (await list.json()) as { labels?: { id: string; name: string }[] };
    const existing = (j.labels ?? []).find((l) => l.name === name);
    if (existing) return existing.id;
    const create = await gmailFetch("/labels", {
      method: "POST",
      body: JSON.stringify({
        name,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    });
    if (!create.ok) return null;
    return ((await create.json()) as { id: string }).id;
  } catch {
    return null;
  }
}

async function createDraft(args: {
  to: string;
  subject: string;
  body: string;
  labelId: string | null;
}): Promise<{ id: string } | null> {
  const raw = buildRawDraft(args.to, args.subject, args.body);
  const draftRes = await gmailFetch("/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw } }),
  });
  if (!draftRes.ok) return null;
  const draft = (await draftRes.json()) as {
    id: string;
    message?: { id?: string };
  };
  if (args.labelId && draft.message?.id) {
    await gmailFetch(`/messages/${draft.message.id}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: [args.labelId] }),
    });
  }
  return { id: draft.id };
}

async function _observedImpl(): Promise<Response> {
  const sb = createServiceClient();
  const today = todayAthens();

  // 1. Fetch due milestones (today or earlier, pending, no draft yet).
  const { data: rawMilestones, error: msErr } = await sb
    .from("charter_lifecycle_milestones")
    .select(
      "id, deal_id, contact_id, milestone_type, due_date, status, auto_action, gmail_draft_id",
    )
    .lte("due_date", today)
    .eq("status", "pending")
    .is("gmail_draft_id", null)
    .limit(200);

  if (msErr) {
    // Schema not applied yet — graceful no-op.
    return NextResponse.json({
      ok: true,
      hint: "charter_lifecycle_milestones table not present yet; apply v3-charter-engine-migration.sql in Supabase Studio.",
      detail: msErr.message,
      drafted: 0,
      skipped: 0,
    });
  }

  const milestones = (rawMilestones ?? []) as MilestoneRow[];
  if (milestones.length === 0) {
    return NextResponse.json({
      ok: true,
      drafted: 0,
      skipped: 0,
      due_today: 0,
      hint: "No pending milestones due today.",
    });
  }

  // 2. Hydrate deals + primary contacts in bulk.
  const dealIds = Array.from(
    new Set(milestones.map((m) => m.deal_id).filter(Boolean)),
  ) as string[];
  let dealMap = new Map<string, DealRow>();
  if (dealIds.length) {
    const { data: deals } = await sb
      .from("deals")
      .select(
        "id, primary_contact_id, vessel_name, charter_start_date, charter_end_date, embark_port, disembark_port",
      )
      .in("id", dealIds);
    dealMap = new Map(((deals ?? []) as DealRow[]).map((d) => [d.id, d]));
  }
  const contactIds = Array.from(
    new Set(
      [...dealMap.values()]
        .map((d) => d.primary_contact_id)
        .concat(milestones.map((m) => m.contact_id))
        .filter(Boolean),
    ),
  ) as string[];
  let contactMap = new Map<string, ContactRow>();
  if (contactIds.length) {
    const { data: contacts } = await sb
      .from("contacts")
      .select("id, first_name, last_name, email")
      .in("id", contactIds);
    contactMap = new Map(
      ((contacts ?? []) as ContactRow[]).map((c) => [c.id, c]),
    );
  }

  // 3. Process each milestone.
  let drafted = 0;
  let skippedNoTemplate = 0;
  let skippedNoEmail = 0;
  let failed = 0;
  const breakdown: Record<string, number> = {};

  for (const m of milestones) {
    const templateKey = TEMPLATE_KEY[m.milestone_type];
    if (!templateKey) {
      skippedNoTemplate += 1;
      continue;
    }
    const deal = m.deal_id ? dealMap.get(m.deal_id) : null;
    if (!deal) {
      skippedNoEmail += 1;
      continue;
    }
    const contactId = deal.primary_contact_id ?? m.contact_id;
    const contact = contactId ? contactMap.get(contactId) : null;
    if (!contact?.email) {
      skippedNoEmail += 1;
      continue;
    }

    const ctx: TemplateContext = {
      client_first_name: contact.first_name ?? "there",
      vessel_name: deal.vessel_name ?? "your charter",
      charter_start_date: deal.charter_start_date ?? "",
      charter_end_date: deal.charter_end_date ?? "",
      embark_port: deal.embark_port ?? "the marina",
    };
    const tmpl = generateMilestoneDraft(templateKey, ctx);
    if (!tmpl) {
      skippedNoTemplate += 1;
      continue;
    }

    const labelId = await getOrCreateLabelId(
      `gy-charter-lifecycle/${m.milestone_type}`,
    );
    const draft = await createDraft({
      to: contact.email,
      subject: tmpl.subject,
      body: tmpl.body,
      labelId,
    });
    if (!draft) {
      failed += 1;
      continue;
    }

    await sb
      .from("charter_lifecycle_milestones")
      .update({
        gmail_draft_id: draft.id,
        gmail_draft_created_at: new Date().toISOString(),
      })
      .eq("id", m.id);

    drafted += 1;
    breakdown[m.milestone_type] = (breakdown[m.milestone_type] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    today,
    due_today: milestones.length,
    drafted,
    skipped_no_template: skippedNoTemplate,
    skipped_no_email: skippedNoEmail,
    failed,
    breakdown,
  });
}

export async function GET(): Promise<Response> {
  return observeCron("charter-lifecycle-fire", _observedImpl);
}
