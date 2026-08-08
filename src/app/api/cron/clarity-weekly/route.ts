// The Monday morning Clarity report.
//
// 2026-08-08. George asked for a full report by email every Monday. This reads
// the seven days that src/app/api/cron/clarity-collect gathered and writes one
// plain-text email.
//
// Email rather than Telegram, on purpose. A Telegram message gets read on a
// phone between two other things and is gone; this is a report to sit with
// over coffee, and it is the format he asked for.
//
// It always sends on a Monday, even when the week was quiet, because "no
// friction found" is a real answer and silence is indistinguishable from a
// broken cron. It says plainly which days are missing rather than averaging
// over the gap.

import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import { readBuffer, buildWeek, renderWeekEmail } from "@/lib/clarity";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAYS_IN_REPORT = 7;

function createRawEmail(to: string, subject: string, body: string): string {
  const lines = [
    "From: George Yachts <george@georgeyachts.com>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

async function _observedImpl(request: NextRequest): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const isVercelCron = request.headers.get("user-agent")?.includes("vercel-cron");
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const all = await readBuffer();
  const week = all.slice(-DAYS_IN_REPORT);

  if (week.length === 0) {
    // Nothing collected at all. That is a broken pipeline, not a quiet week,
    // and it should reach him on the channel he actually notices.
    await sendTelegram(
      "⚠️ No Clarity report this Monday: nothing has been collected. Check CLARITY_API_TOKEN and the clarity-collect cron.",
    );
    return NextResponse.json({ ok: false, reason: "empty-buffer" });
  }

  const report = buildWeek(week);
  const body = renderWeekEmail(report);

  const subject =
    report.frictionPages.length > 0
      ? `Clarity, week to ${report.to}: ${report.frictionPages.length} pages with friction`
      : `Clarity, week to ${report.to}: ${report.humanSessions.toLocaleString("en-US")} real visits, nothing broken`;

  const sendRes = await gmailFetch("/messages/send", {
    method: "POST",
    body: JSON.stringify({
      raw: createRawEmail("george@georgeyachts.com", subject, body),
    }),
  });

  if (!sendRes.ok) {
    await sendTelegram(
      "⚠️ The Clarity weekly report was built but Gmail refused to send it. The data is safe; only the delivery failed.",
    );
  }

  return NextResponse.json({
    ok: true,
    emailSent: sendRes.ok,
    days: report.days,
    from: report.from,
    to: report.to,
    sessions: report.sessions,
    bots: report.botSessions,
    friction: report.frictionPages.length,
    missingDays: report.missingDays,
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return observeCron("clarity-weekly", () => _observedImpl(request));
}
