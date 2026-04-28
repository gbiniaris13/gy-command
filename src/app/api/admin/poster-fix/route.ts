// One-shot recovery endpoint to drain the approval backlog.
//
// Bumps every ig_posts row stuck in `pending_approval` to `scheduled`
// so the publish cron picks them up at their existing schedule_time.
// Idempotent — running twice does nothing extra.
//
// Also flips the global `caption_auto_approve` setting to "true" so
// every future generator run enqueues directly to scheduled.
//
// George's directive 2026-04-28: full automatic publishing, no
// Telegram approval gate.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const sb = createServiceClient();

  // 1 — set the global auto-approve flag.
  await sb
    .from("settings")
    .upsert(
      {
        key: "caption_auto_approve",
        value: "true",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

  await sb
    .from("settings")
    .upsert(
      {
        key: "reel_auto_publish_without_approval",
        value: "true",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

  // 2 — promote pending_approval backlog to scheduled.
  const { data: backlog } = await sb
    .from("ig_posts")
    .select("id, post_type, schedule_time")
    .eq("status", "pending_approval");

  let promoted = 0;
  for (const row of (backlog ?? []) as {
    id: string;
    post_type: string | null;
    schedule_time: string;
  }[]) {
    const { error } = await sb
      .from("ig_posts")
      .update({ status: "scheduled" })
      .eq("id", row.id);
    if (!error) promoted += 1;
  }

  // 3 — also bump any 'draft' rows that landed there from the
  // CHECK-constraint fallback in the approval gate code. These were
  // intended to be scheduled but ended up stuck.
  const { data: drafts } = await sb
    .from("ig_posts")
    .select("id, error, schedule_time")
    .eq("status", "draft")
    .is("error", null);
  let promotedDrafts = 0;
  for (const row of (drafts ?? []) as { id: string; schedule_time: string }[]) {
    if (!row.schedule_time) continue;
    const { error } = await sb
      .from("ig_posts")
      .update({ status: "scheduled" })
      .eq("id", row.id);
    if (!error) promotedDrafts += 1;
  }

  await sendTelegram(
    `🛠 <b>Poster auto-mode enabled</b>\n` +
      `caption_auto_approve = true\n` +
      `reel_auto_publish_without_approval = true\n` +
      `Promoted ${promoted} pending_approval + ${promotedDrafts} draft rows to scheduled.`,
  ).catch(() => {});

  return NextResponse.json({
    ok: true,
    flags_set: {
      caption_auto_approve: "true",
      reel_auto_publish_without_approval: "true",
    },
    promoted_pending_approval: promoted,
    promoted_drafts: promotedDrafts,
  });
}
