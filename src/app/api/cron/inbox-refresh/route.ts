// Inbox-refresh cron — recomputes inbox_* fields on every contact.
//
// Live updates already happen on inbound (gmail-poll-replies) and
// outbound (gmail/send). This cron exists for two reasons:
//   1. Drift correction — if any live hook fails silently, the
//      nightly pass restores accuracy.
//   2. Time-based stage transitions — a contact whose last activity
//      crosses the 7d or 30d boundary needs the stage label updated
//      even when no new message arrives.
//
// Cheap to run (one Supabase pull + one update per contact, no
// network calls per row). Runs 03:30 Athens.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { refreshAllContactsInbox } from "@/lib/inbox-analyzer";
import { sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try {
    const sb = createServiceClient();
    const result = await refreshAllContactsInbox(sb);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    await sendTelegram(
      `⚠️ <b>Inbox-refresh cron crashed</b>\n<code>${msg.slice(0, 300)}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
