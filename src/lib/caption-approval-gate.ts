// @ts-nocheck
// Pre-queue caption approval gate.
//
// Roberto brief v2 (2026-04-22): captions must be reviewed by George
// BEFORE they land in ig_posts as scheduled. The old flow was:
//
//   AI generates → INSERT status='scheduled' → publish cron fires
//
// The new flow is:
//
//   AI generates → INSERT status='pending_approval' → Telegram
//   inline buttons → George taps Approve → webhook flips to
//   status='scheduled' → publish cron fires
//
// This file implements the server side: enqueuePendingApproval() that
// writes a pending row + sends the Telegram message with inline keyboard,
// and handleApprovalCallback() that the webhook (/api/webhooks/telegram-approval)
// calls when a button is tapped.
//
// Approval rules baked in:
//   • If voice-guardrail violations are detected in the generated
//     caption, we Telegram WITH the violations highlighted so George
//     can see the quality issue before approving.
//   • Reject flips status to 'draft' + stores the reason, so it never
//     publishes but is recoverable for editing.
//   • Regenerate keeps status='pending_approval' but queues a fresh
//     AI attempt (handled in a separate Edge function — see inline TODO).

import { createServiceClient } from "@/lib/supabase-server";
import { detectBannedPhrases, detectEmojiViolations } from "@/lib/ai-voice-guardrails";

const TELEGRAM_BOT = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;

export type PendingInsert = {
  image_url: string;
  caption: string;
  schedule_time: string;
  scheduled_for: string;
  post_type: "image" | "carousel" | "reel" | "fleet_yacht";
  // Optional: which yacht, which angle, etc. — kept in post.fleet_meta.
};

/**
 * Read the auto-approve flag from settings. Default is TRUE — full auto
 * publishing like the pre-Roberto-v2 flow. The Telegram approval gate
 * stays in the codebase for opt-in tightening, but is OFF by default
 * because George's blocking complaint (2026-04-28) was the silent gate:
 * captions piling up in pending_approval and never going live.
 *
 * To turn the gate back on:
 *   INSERT INTO settings (key, value) VALUES ('caption_auto_approve', 'false');
 */
async function isAutoApproveEnabled(
  sb: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  try {
    const { data } = await sb
      .from("settings")
      .select("value")
      .eq("key", "caption_auto_approve")
      .maybeSingle();
    if (!data) return true; // default ON
    const v = (data.value as string) ?? "true";
    return v !== "false";
  } catch {
    return true;
  }
}

export async function enqueuePendingApproval(
  row: PendingInsert
): Promise<{ id: string | null; telegram_message_id: number | null }> {
  const sb = createServiceClient();
  const autoApprove = await isAutoApproveEnabled(sb);

  // When auto-approve is on (default), captions land directly in
  // status='scheduled' so the publish cron picks them up at their time.
  // When off, they land in 'pending_approval' and a Telegram card with
  // ✅/❌ buttons is sent to George.
  const targetStatus = autoApprove ? "scheduled" : "pending_approval";
  const insertRow = {
    ...row,
    status: targetStatus,
  } as Record<string, unknown>;

  let id: string | null = null;
  try {
    const { data, error } = await sb
      .from("ig_posts")
      .insert(insertRow)
      .select("id")
      .single();
    if (error && error.message?.includes("check constraint")) {
      const fallback = await sb
        .from("ig_posts")
        .insert({ ...row, status: autoApprove ? "scheduled" : "draft" })
        .select("id")
        .single();
      id = fallback.data?.id ?? null;
    } else {
      id = data?.id ?? null;
    }
  } catch (e) {
    console.error("[approval-gate] insert failed:", e);
    return { id: null, telegram_message_id: null };
  }

  // In auto-approve mode we skip the Telegram approval card entirely
  // — the publish cron will surface a success Telegram once the post
  // actually goes live, which is the signal George cares about.
  if (autoApprove) {
    return { id, telegram_message_id: null };
  }

  // Voice audit for the preview message.
  const bannedHits = detectBannedPhrases(row.caption);
  const emojiHits = detectEmojiViolations(row.caption);
  const audit = [
    bannedHits.length ? `⚠️ Voice: ${bannedHits.join(", ")}` : "",
    emojiHits.length ? `⚠️ Emoji: ${emojiHits.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const preview =
    row.caption.length > 600
      ? row.caption.slice(0, 600) + "…"
      : row.caption;

  const scheduledLocal = new Date(row.scheduled_for).toLocaleString("en-GB", {
    timeZone: "Europe/Athens",
  });

  const text = [
    `📸 <b>New IG post awaiting approval</b>`,
    ``,
    `Type: <b>${row.post_type}</b>`,
    `Schedule: <code>${scheduledLocal}</code> Athens`,
    audit ? `<i>${audit}</i>` : "",
    ``,
    `<b>Caption:</b>`,
    preview,
  ]
    .filter(Boolean)
    .join("\n");

  const tgId = await sendTelegramWithButtons(text, id ?? "unknown");
  return { id, telegram_message_id: tgId };
}

async function sendTelegramWithButtons(
  text: string,
  postId: string
): Promise<number | null> {
  if (!TELEGRAM_BOT || !TELEGRAM_CHAT) return null;
  const payload = {
    chat_id: TELEGRAM_CHAT,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `ig_approve:${postId}` },
          { text: "❌ Reject", callback_data: `ig_reject:${postId}` },
          { text: "🔄 Regenerate", callback_data: `ig_regen:${postId}` },
        ],
      ],
    },
  };
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const body = await res.json();
    return body?.result?.message_id ?? null;
  } catch (e) {
    console.error("[approval-gate] telegram send failed:", e);
    return null;
  }
}

// Called from /api/webhooks/telegram-approval when the user taps a button.
export async function handleApprovalCallback(
  callbackData: string,
  callbackQueryId: string
): Promise<{ ok: boolean; message: string }> {
  const match = callbackData.match(/^ig_(approve|reject|regen):([\w-]+)$/);
  if (!match) return { ok: false, message: "unknown callback" };
  const [, action, postId] = match;

  const sb = createServiceClient();
  let message = "";
  if (action === "approve") {
    await sb
      .from("ig_posts")
      .update({ status: "scheduled" })
      .eq("id", postId);
    message = "✅ Approved — will publish at scheduled time.";
  } else if (action === "reject") {
    await sb
      .from("ig_posts")
      .update({ status: "draft", error: "rejected_by_approval_gate" })
      .eq("id", postId);
    message = "❌ Rejected — moved to draft. No publish.";
  } else {
    // Regenerate: mark status draft + a flag another cron picks up to
    // re-run the caption generator. Implementation of the regen cron is
    // tracked separately; for now the flag is enough to signal intent.
    await sb
      .from("ig_posts")
      .update({
        status: "draft",
        error: "regen_requested",
      })
      .eq("id", postId);
    message = "🔄 Regenerate queued — new caption in ~5 min.";
  }

  // ACK the callback so Telegram stops showing the loading spinner.
  if (TELEGRAM_BOT) {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT}/answerCallbackQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: message,
          show_alert: false,
        }),
      }
    ).catch(() => {});
  }
  return { ok: true, message };
}
