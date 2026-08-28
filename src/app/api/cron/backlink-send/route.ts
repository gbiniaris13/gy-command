// @ts-nocheck
import { NextResponse } from "next/server";
import { gmailFetch, getSetting, setSetting } from "@/lib/google-api";
import { observeCron } from "@/lib/cron-observer";

// Backlink pitch sender — the CLOUD half of the backlink engine.
//
// Why this exists (2026-08-28): the engine's only sender was a local
// scheduled task on George's Mac at 09:15. The Mac was closed on the
// mornings of 26, 27 and 28 August and THREE send days were silently
// lost (last real send 25/8, verified in Gmail sent). George's order:
// "δεν γίνεται να γίνεται μόνο του, τελείως;" — yes, like this.
//
// Division of labour, deliberately split by what each side is good at:
//   - The local Mac task is the WRITER. It reads the target's actual
//     page and rewrites each pitch's opening (the quality bar that got
//     the 24/8 generic-body incident), then marks the item "ready".
//     It NEVER sends any more.
//   - This cron is the SENDER. Dumb on purpose: takes the first
//     "ready" item by pos, sends it verbatim, marks it "sent". It
//     never composes and never touches "held" items (generic bodies).
//
// One email per weekday, enforced here by sent_at date check. If the
// ready buffer runs dry (Mac closed for days), George gets ONE email
// about it, flag-guarded, and the flag clears itself on the next
// successful send.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const QUEUE_KEY = "backlink_pitch_queue";
const DRY_FLAG = "backlink_ready_empty_notified";
const GEORGE = "george@georgeyachts.com";

function rawEmail(to: string, subject: string, body: string): string {
  const boundary = "boundary_" + Date.now();
  const lines = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    body.replace(/\n/g, "<br>"),
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

async function send(to: string, subject: string, body: string) {
  const res = await gmailFetch("/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: rawEmail(to, subject, body) }),
  });
  if (!res.ok) throw new Error(`gmail send ${res.status}: ${await res.text()}`);
  return res.json();
}

async function handler(): Promise<Response> {
  const now = new Date();
  const athens = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Athens" }));
  const day = athens.getDay();
  if (day === 0 || day === 6) {
    return NextResponse.json({ skipped: "weekend — pitches go out Monday to Friday" });
  }

  const rawQueue = await getSetting(QUEUE_KEY);
  if (!rawQueue) return NextResponse.json({ error: "queue setting missing" });
  const queue = JSON.parse(rawQueue);

  // One per day: if anything already went out today (cloud OR the old
  // local sender), stand down.
  const today = athens.toISOString().slice(0, 10);
  const sentToday = queue.some(
    (i) => i.status === "sent" && String(i.sent_at ?? "").slice(0, 10) === today,
  );
  if (sentToday) return NextResponse.json({ skipped: "already sent today" });

  const next = queue
    .filter((i) => i.status === "ready")
    .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))[0];

  if (!next) {
    // Buffer dry. Tell George once, not daily.
    const flagged = await getSetting(DRY_FLAG);
    if (!flagged) {
      await send(
        GEORGE,
        "Backlink engine: no pitch ready to send",
        [
          "The cloud sender found no pitch marked ready.",
          "",
          "The Mac writer task prepares the openings; if the Mac has been closed for a few days the buffer runs out. Open the laptop and the next scheduled run will refill it.",
          "",
          "No email was sent to any outlet today.",
        ].join("\n"),
      );
      await setSetting(DRY_FLAG, new Date().toISOString());
    }
    return NextResponse.json({ skipped: "no ready pitch in buffer" });
  }

  // Safety: a ready item must have been de-flagged by the writer.
  if (next.needs_page_specific_opening) {
    return NextResponse.json({
      error: `pos ${next.pos} is marked ready but still flagged needs_page_specific_opening — refusing to send a generic body`,
    });
  }

  const result = await send(next.to, next.subject, next.body);

  next.status = "sent";
  next.sent_at = new Date().toISOString();
  next.sent_message_id = result?.id ?? null;
  next.sent_by = "cloud-cron";
  await setSetting(QUEUE_KEY, JSON.stringify(queue));
  await setSetting(DRY_FLAG, "");

  return NextResponse.json({
    ok: true,
    sent: { pos: next.pos, to: next.to, subject: next.subject, message_id: result?.id },
    ready_left: queue.filter((i) => i.status === "ready").length,
    held_left: queue.filter((i) => i.status === "held").length,
  });
}

export async function GET() {
  return observeCron("backlink-send", handler);
}
