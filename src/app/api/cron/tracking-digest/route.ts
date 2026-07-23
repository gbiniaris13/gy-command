// Tracking digest — 15:00 UTC daily (18:00 Athens). One email to George with
// the last 24h of opens/clicks across every tracked send, plus anything sent
// in the last 3 days that is still unopened (the follow-up radar).

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { emailGeorgeReport, athensTime } from "@/lib/email-tracking";
import { observeCron } from "@/lib/cron-observer";

export const runtime = "nodejs";
export const maxDuration = 60;

type Row = {
  recipient: string | null;
  subject: string | null;
  source: string;
  sent_at: string;
  first_open_at: string | null;
  last_open_at: string | null;
  open_count: number;
  click_count: number;
  last_click_url: string | null;
};

async function _impl(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = createServiceClient();
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();

  const { data: active } = await sb
    .from("email_tracking")
    .select("recipient, subject, source, sent_at, first_open_at, last_open_at, open_count, click_count, last_click_url")
    .or(`last_open_at.gte.${dayAgo},last_click_at.gte.${dayAgo}`)
    .order("last_open_at", { ascending: false })
    .limit(50);

  const { data: unopened } = await sb
    .from("email_tracking")
    .select("recipient, subject, source, sent_at, first_open_at, last_open_at, open_count, click_count, last_click_url")
    .gte("sent_at", threeDaysAgo)
    .is("first_open_at", null)
    .order("sent_at", { ascending: false })
    .limit(30);

  const act = (active || []) as Row[];
  const cold = (unopened || []) as Row[];

  if (act.length === 0 && cold.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no tracked activity" });
  }

  const lines: string[] = [
    `Good evening George — email tracking, last 24 hours.`,
    ``,
  ];

  if (act.length) {
    lines.push(`ACTIVITY (${act.length})`);
    for (const r of act) {
      lines.push(
        `  ${r.recipient || "unknown"} — "${(r.subject || "").slice(0, 60)}"`,
        `    opens: ${r.open_count}${r.first_open_at ? ` (first ${athensTime(r.first_open_at)})` : ""}` +
          `${r.click_count ? `  ·  clicks: ${r.click_count} → ${r.last_click_url || ""}` : ""}`,
      );
    }
    lines.push("");
  }

  if (cold.length) {
    lines.push(`STILL UNOPENED — sent in the last 3 days (${cold.length})`);
    for (const r of cold) {
      lines.push(`  ${r.recipient || "unknown"} — "${(r.subject || "").slice(0, 60)}" · sent ${athensTime(r.sent_at)}`);
    }
    lines.push("", `These are your follow-up candidates.`);
  }

  lines.push("", `All times Athens. Counted by our own tracker — no third parties.`);

  const emailed = await emailGeorgeReport(
    `\u{1F4CA} Email tracking: ${act.length} active, ${cold.length} unopened`,
    lines.join("\n"),
  );

  return NextResponse.json({ ok: true, emailed, active: act.length, unopened: cold.length });
}

export async function GET(request: NextRequest): Promise<Response> {
  return observeCron("tracking-digest", () => _impl(request));
}
