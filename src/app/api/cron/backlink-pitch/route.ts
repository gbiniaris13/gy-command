// GET /api/cron/backlink-pitch — weekday mornings. George's directive
// 2026-07-14 ("εκεί θα απογειωθούμε"): one backlink pitch per business
// day, sent automatically from george@ via the existing Gmail OAuth.
//
// Safety model:
//   - The queue (settings key backlink_pitch_queue) holds PRE-WRITTEN,
//     human-quality texts curated during the weekly prospecting pass —
//     nothing is generated at send time, so no facts can be invented.
//   - Gmail appends George's signature automatically; queue bodies end
//     with a bare "Warm regards, George".
//   - Exactly ONE send per invocation, weekdays only, and a Telegram
//     ping on every send so George sees each one the moment it leaves.
//   - Empty queue → single Telegram notice (not a daily nag).

import { NextRequest, NextResponse } from "next/server";
import { sendHelmEmail } from "@/lib/helm/gmail-send";
import { getSetting, setSetting } from "@/lib/google-api";

export const runtime = "nodejs";
export const maxDuration = 60;

type Pitch = {
  pos: number;
  target: string;
  to: string;
  subject: string;
  body: string;
  status: "queued" | "sent" | "failed";
  sent_at?: string;
  error?: string;
};

const QUEUE_KEY = "backlink_pitch_queue";
const EMPTY_FLAG = "backlink_queue_empty_notified";

async function ping(text: string) {
  try {
    const { sendTelegram } = await import("@/lib/telegram");
    await sendTelegram(text);
  } catch (e) {
    console.error("[backlink-pitch] telegram failed", e);
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Weekday etiquette: journalists' inboxes on Saturday get us marked
  // as noise. The Vercel schedule is already 1-5, this guards manual runs.
  const day = new Date().getUTCDay();
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force && (day === 0 || day === 6)) {
    return NextResponse.json({ ok: true, skipped: "weekend" });
  }

  const raw = await getSetting(QUEUE_KEY);
  const queue: Pitch[] = raw ? JSON.parse(raw) : [];
  const next = queue.find((p) => p.status === "queued");

  if (!next) {
    if (!(await getSetting(EMPTY_FLAG))) {
      await ping(
        "📭 <b>Backlink pitch queue is empty.</b>\nFable refills it during the Monday SEO routine. No emails are going out until then.",
      );
      await setSetting(EMPTY_FLAG, new Date().toISOString());
    }
    return NextResponse.json({ ok: true, sent: 0, remaining: 0 });
  }

  try {
    await sendHelmEmail({ to: next.to, subject: next.subject, body: next.body });
    next.status = "sent";
    next.sent_at = new Date().toISOString();
  } catch (e) {
    next.status = "failed";
    next.error = String((e as Error).message).slice(0, 200);
    await setSetting(QUEUE_KEY, JSON.stringify(queue));
    await ping(
      `⚠️ <b>Backlink pitch FAILED</b>\n${next.target} (${next.to})\n${next.error}\nIt is marked failed and will not retry automatically.`,
    );
    return NextResponse.json({ ok: false, failed: next.target }, { status: 500 });
  }

  await setSetting(QUEUE_KEY, JSON.stringify(queue));
  await setSetting(EMPTY_FLAG, "");
  const remaining = queue.filter((p) => p.status === "queued").length;
  await ping(
    [
      `📤 <b>Backlink pitch sent</b>`,
      `${next.target} · ${next.to}`,
      `"${next.subject}"`,
      `${remaining} remaining in the queue.`,
    ].join("\n"),
  );

  return NextResponse.json({ ok: true, sent: next.target, remaining });
}
