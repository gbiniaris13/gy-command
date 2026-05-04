// @ts-nocheck
import { NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import { getIgTokenOptional } from "@/lib/ig-token";

// Cron: daily 15:00 UTC (18:00 Athens).
// Scans for @georgeyachts tags/mentions on Instagram.
// Alerts George via Telegram for potential reposts.

async function _observedImpl() {
  const igToken = getIgTokenOptional();
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return NextResponse.json({ error: "IG not configured" });
  }

  try {
    // Fetch tagged media (posts where @georgeyachts is tagged)
    const taggedRes = await fetch(
      `https://graph.instagram.com/v21.0/${igId}/tags?fields=id,caption,media_type,media_url,timestamp,username&limit=10&access_token=${encodeURIComponent(igToken)}`
    );

    let tagged = [];
    if (taggedRes.ok) {
      const taggedData = await taggedRes.json();
      tagged = taggedData.data || [];
    }

    // Fetch recent mentions (from mentioned_media)
    const mentionsRes = await fetch(
      `https://graph.instagram.com/v21.0/${igId}/mentioned_media?fields=id,caption,media_type,timestamp&limit=10&access_token=${encodeURIComponent(igToken)}`
    );

    let mentions = [];
    if (mentionsRes.ok) {
      const mentionsData = await mentionsRes.json();
      mentions = mentionsData.data || [];
    }

    const totalFound = tagged.length + mentions.length;

    if (totalFound === 0) {
      return NextResponse.json({ ok: true, found: 0 });
    }

    // Filter to last 24h
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentTagged = tagged.filter(t => new Date(t.timestamp).getTime() > dayAgo);
    const recentMentions = mentions.filter(m => new Date(m.timestamp).getTime() > dayAgo);

    if (recentTagged.length + recentMentions.length === 0) {
      return NextResponse.json({ ok: true, found: 0, note: "no new mentions in 24h" });
    }

    // Alert George
    let alert = `📸 <b>UGC Alert — ${recentTagged.length + recentMentions.length} new mentions</b>\n\n`;

    for (const t of recentTagged) {
      alert += `🏷 Tagged by <b>@${t.username || "unknown"}</b>\n`;
      alert += `<i>"${(t.caption || "").slice(0, 80)}..."</i>\n`;
      if (t.media_url) alert += `${t.media_url}\n`;
      alert += `\n`;
    }

    for (const m of recentMentions) {
      alert += `💬 Mentioned in post\n`;
      alert += `<i>"${(m.caption || "").slice(0, 80)}..."</i>\n\n`;
    }

    alert += `Consider reposting the best ones! 🔄`;

    await sendTelegram(alert);

    return NextResponse.json({
      ok: true,
      tagged: recentTagged.length,
      mentions: recentMentions.length,
    });
  } catch (err) {
    // Return HTTP 500 (was 200) so Vercel cron UI + runtime observer
    // surfaces UGC errors instead of silently marking them "ok".
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}


// Observability wrapper — records success/error/skipped/timeout
// outcomes to settings KV for the Thursday ops report.
export async function GET(...args: any[]) {
  return observeCron("instagram-ugc", () => (_observedImpl as any)(...args));
}
