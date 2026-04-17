// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

// Cron: daily 10:00 UTC (13:00 Athens).
// Sends soft follow-up DM to people who received a welcome DM 5 days ago
// and haven't replied since. Non-pushy, one-time only.

const FOLLOW_UP_DAYS = 5;

const FOLLOW_UP_MESSAGES = [
  "Hey! Just wanted to check in — if you're ever thinking about Greece by sea this season, I'm happy to share some ideas. No pressure at all. ⚓",
  "Quick hello — if a Greek island charter is on the radar for this year, even just as an idea, I'd love to help you think through it. No commitment needed. 🇬🇷",
  "Hope you're having a great week! If the Greek islands are calling, we put together personalized itineraries all season long. Just say the word. ⛵",
  "Just a friendly nudge — summer in Greece is something else. If you're curious about chartering, even just exploring what's possible, I'm here. No rush. 🌊",
];

export async function GET() {
  const igToken = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return NextResponse.json({ error: "IG not configured" });
  }

  const sb = createServiceClient();

  // Find welcome DMs sent exactly 5 days ago (±12h window)
  const targetDate = new Date(Date.now() - FOLLOW_UP_DAYS * 86400000);
  const windowStart = new Date(targetDate.getTime() - 12 * 3600000).toISOString();
  const windowEnd = new Date(targetDate.getTime() + 12 * 3600000).toISOString();

  const { data: welcomeDMs } = await sb
    .from("ig_dm_replies")
    .select("sender_id, sent_at")
    .gte("sent_at", windowStart)
    .lte("sent_at", windowEnd)
    .or("intent.eq.general,intent.eq.story_mention");

  if (!welcomeDMs || welcomeDMs.length === 0) {
    return NextResponse.json({ ok: true, followed_up: 0, reason: "no welcome DMs from 5 days ago" });
  }

  let sent = 0;
  for (const dm of welcomeDMs) {
    // Check if we already sent a follow-up to this person
    const { data: existing } = await sb
      .from("ig_dm_replies")
      .select("id")
      .eq("sender_id", dm.sender_id)
      .eq("intent", "followup_5d")
      .limit(1);

    if (existing && existing.length > 0) continue; // Already followed up

    // Check if they replied after the welcome (if so, skip — conversation is active)
    const { data: theirReplies } = await sb
      .from("ig_dm_replies")
      .select("id")
      .eq("sender_id", dm.sender_id)
      .gt("sent_at", dm.sent_at)
      .limit(1);

    // Only skip if THEY replied (not our auto-replies)
    // For now, if there are more than 1 interaction, assume conversation happened
    const { count: totalInteractions } = await sb
      .from("ig_dm_replies")
      .select("id", { count: "exact", head: true })
      .eq("sender_id", dm.sender_id);

    if ((totalInteractions || 0) > 2) continue; // Active conversation, don't follow up

    // Pick a follow-up message (rotate by sender)
    const msgIndex = parseInt(dm.sender_id.slice(-2), 16) % FOLLOW_UP_MESSAGES.length;
    const message = FOLLOW_UP_MESSAGES[msgIndex];

    try {
      await fetch(`https://graph.instagram.com/v21.0/me/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: dm.sender_id },
          message: { text: message },
          access_token: igToken,
        }),
      });

      await sb.from("ig_dm_replies").insert({
        sender_id: dm.sender_id,
        message_text: "",
        intent: "followup_5d",
        reply_text: message,
        sent_at: new Date().toISOString(),
      });

      sent++;
    } catch (err) {
      console.error(`Follow-up DM failed for ${dm.sender_id}:`, err);
    }

    // Delay between DMs
    await new Promise(r => setTimeout(r, 5000));
  }

  if (sent > 0) {
    await sendTelegram(`📨 <b>Follow-up DMs sent:</b> ${sent}\n5-day soft nudge to welcome recipients.`);
  }

  return NextResponse.json({ ok: true, followed_up: sent });
}
