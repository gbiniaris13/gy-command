// GET /api/cron/helm-followup — daily. For each Sent request with a Gmail
// thread: (1) capture any new client reply (→ In Conversation, clear
// follow_up_at); (2) if still no reply and follow_up_at is past, email George
// a reminder (NEVER the client; NO Calendar write) and bump follow_up_at +3d.
//
// Isolated from the existing gmail-poll-replies inbox cron. Guarded by the
// shared CRON_SECRET — same free Vercel-cron mechanism as charter-reminders,
// no new paid service. Runs once a day; the on-demand /check-replies route
// covers instant pulls.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { captureReplies } from "@/lib/helm/replies";
import { sendHelmEmail } from "@/lib/helm/gmail-send";

export const runtime = "nodejs";
export const maxDuration = 60;

const REMINDER_TO = "george@georgeyachts.com";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const { data: rows, error } = await db
    .from("helm_requests")
    .select("id, client_name, client_surname, client_title, status, follow_up_at, gmail_thread_id")
    .eq("status", "sent")
    .not("gmail_thread_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  let replies = 0;
  let reminders = 0;

  for (const r of rows || []) {
    // 1) Capture replies first — may move the request to in_conversation.
    let cap = { newReplies: 0 };
    try {
      cap = await captureReplies(r.id);
    } catch (e) {
      console.error("[helm-followup] captureReplies failed", r.id, e);
    }
    if (cap.newReplies > 0) {
      replies++;
      continue; // got a reply → no reminder
    }
    // 2) No reply — remind George if the 4-day mark has passed.
    if (r.follow_up_at && new Date(r.follow_up_at).getTime() <= now) {
      const name = r.client_surname
        ? `${r.client_title ? r.client_title + ". " : ""}${r.client_surname}`
        : r.client_name || "the client";
      try {
        await sendHelmEmail({
          to: REMINDER_TO,
          subject: `Follow up: ${name} - no reply yet on your charter proposal`,
          body:
            `Reminder from The Helm.\n\n` +
            `${name} has not replied to the proposal you sent. A gentle follow-up may help.\n\n` +
            `Open the request in GY Command to see the thread and send a reply. ` +
            `This is an internal nudge only - nothing has been sent to the client.\n\n` +
            `Warmly,\nThe Helm`,
        });
        reminders++;
        await db
          .from("helm_requests")
          .update({
            follow_up_at: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
      } catch (e) {
        console.error("[helm-followup] reminder failed", r.id, e);
      }
    }
  }

  return NextResponse.json({ ok: true, scanned: rows?.length || 0, replies, reminders });
}
