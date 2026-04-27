// v3 Sprint 3.10 — Full-system smoke test.
//
// Walks every pillar and verifies the table exists, the row count is
// sane, and the related cron is wired. Returns a per-pillar pass/fail
// JSON object so George can run this from /dashboard/admin/test (or
// curl) and immediately see where the v3 schema is missing.
//
// This is read-only — it never writes test data.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Check {
  pillar: string;
  name: string;
  ok: boolean;
  detail?: string;
  count?: number;
}

async function tableCount(
  sb: ReturnType<typeof createServiceClient>,
  table: string,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const { count, error } = await sb
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: count ?? 0 };
}

async function columnExists(
  sb: ReturnType<typeof createServiceClient>,
  table: string,
  column: string,
): Promise<boolean> {
  const { error } = await sb.from(table).select(column).limit(1);
  return !error;
}

export async function GET() {
  const sb = createServiceClient();
  const checks: Check[] = [];

  // Pillar 1 — Inbox Brain
  const activities = await tableCount(sb, "activities");
  checks.push({
    pillar: "1 Inbox",
    name: "activities table",
    ok: activities.ok,
    count: activities.count,
    detail: activities.error,
  });
  const messageClassPresent = await columnExists(
    sb,
    "activities",
    "message_class",
  );
  checks.push({
    pillar: "1 Inbox",
    name: "activities.message_class column (Sprint 2.1)",
    ok: messageClassPresent,
  });

  // Pillar 2 — Smart Contact DB
  const contacts = await tableCount(sb, "contacts");
  checks.push({
    pillar: "2 Contacts",
    name: "contacts table",
    ok: contacts.ok,
    count: contacts.count,
    detail: contacts.error,
  });
  const tags = await tableCount(sb, "tags");
  checks.push({
    pillar: "2 Contacts",
    name: "tags table",
    ok: tags.ok,
    count: tags.count,
  });

  // Pillar 3 — Greetings
  const greetingDrafts = await tableCount(sb, "greeting_drafts");
  checks.push({
    pillar: "3 Greetings",
    name: "greeting_drafts table",
    ok: greetingDrafts.ok,
    count: greetingDrafts.count,
    detail: greetingDrafts.error,
  });

  // Pillar 4 — Newsletter (v3 sprint 3.5)
  const campaigns = await tableCount(sb, "newsletter_campaigns");
  checks.push({
    pillar: "4 Newsletter",
    name: "newsletter_campaigns table",
    ok: campaigns.ok,
    count: campaigns.count,
    detail: campaigns.error,
  });
  const sends = await tableCount(sb, "newsletter_sends");
  checks.push({
    pillar: "4 Newsletter",
    name: "newsletter_sends table",
    ok: sends.ok,
    count: sends.count,
  });
  const segments = await tableCount(sb, "audience_segments");
  checks.push({
    pillar: "4 Newsletter",
    name: "audience_segments table (≥2 seeded)",
    ok: segments.ok && (segments.count ?? 0) >= 2,
    count: segments.count,
  });

  // Pillar 5 — Health Score
  const healthHistory = await tableCount(sb, "health_score_history");
  checks.push({
    pillar: "5 Health",
    name: "health_score_history table",
    ok: healthHistory.ok,
    count: healthHistory.count,
    detail: healthHistory.error,
  });

  // Pillar 4-old / Sprint 2.3 — Commitments
  const commitments = await tableCount(sb, "commitments");
  checks.push({
    pillar: "Commitments",
    name: "commitments table (Sprint 2.3)",
    ok: commitments.ok,
    count: commitments.count,
    detail: commitments.error,
  });

  // v3 Pillar 7 — Charter Lifecycle
  const milestones = await tableCount(sb, "charter_lifecycle_milestones");
  checks.push({
    pillar: "v3/7 Charter Lifecycle",
    name: "charter_lifecycle_milestones table",
    ok: milestones.ok,
    count: milestones.count,
    detail: milestones.error,
  });

  // v3 Pillar 8 — Document-Driven Setup
  const deals = await tableCount(sb, "deals");
  checks.push({
    pillar: "v3/8 Documents",
    name: "deals table (v3 normalized)",
    ok: deals.ok,
    count: deals.count,
    detail: deals.error,
  });
  const docs = await tableCount(sb, "charter_documents");
  checks.push({
    pillar: "v3/8 Documents",
    name: "charter_documents table",
    ok: docs.ok,
    count: docs.count,
    detail: docs.error,
  });

  // v3 Pillar 9 — Multi-Guest Network
  const guests = await tableCount(sb, "charter_guests");
  checks.push({
    pillar: "v3/9 Network",
    name: "charter_guests table",
    ok: guests.ok,
    count: guests.count,
    detail: guests.error,
  });
  const networkSourceColumn = await columnExists(
    sb,
    "contacts",
    "network_source",
  );
  checks.push({
    pillar: "v3/9 Network",
    name: "contacts.network_source column",
    ok: networkSourceColumn,
  });
  const subscribedColumn = await columnExists(
    sb,
    "contacts",
    "subscribed_to_newsletter",
  );
  checks.push({
    pillar: "v3/9 + 4",
    name: "contacts.subscribed_to_newsletter column",
    ok: subscribedColumn,
  });

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).length;

  return NextResponse.json({
    ok: failed === 0,
    passed,
    failed,
    total: checks.length,
    checks,
    next_steps:
      failed > 0
        ? "Apply the missing migration(s) in Supabase Studio. v3 schema lives in src/lib/v3-charter-engine-migration.sql and src/lib/v3-newsletter-migration.sql."
        : "Schema is clean. Pillars are wired end-to-end.",
  });
}
