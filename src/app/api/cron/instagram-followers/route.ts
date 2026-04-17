// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

// Cron: daily 03:11 UTC (06:11 Athens).
// Tracks follower count + alerts on growth.
// Welcome DMs to new followers: Instagram doesn't expose follower list
// or follow events via API. Instead, our webhook auto-welcomes anyone
// who DMs us for the first time (see /api/webhooks/instagram).

export async function GET() {
  const token = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!token || !igId) {
    return NextResponse.json({ error: "IG not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=followers_count,follows_count,media_count&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: `IG API ${res.status}`, body: body.slice(0, 200) }, { status: 502 });
    }
    const json = await res.json();

    const today = new Date().toISOString().slice(0, 10);
    const sb = createServiceClient();

    // Get yesterday's count for comparison
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const { data: yesterdayRow } = await sb
      .from("ig_follower_history")
      .select("followers_count")
      .eq("date", yesterday)
      .maybeSingle();

    const currentFollowers = json.followers_count ?? 0;
    const yesterdayFollowers = yesterdayRow?.followers_count ?? currentFollowers;
    const change = currentFollowers - yesterdayFollowers;

    // Save today's snapshot
    const row = {
      date: today,
      followers_count: currentFollowers,
      follows_count: json.follows_count ?? null,
      media_count: json.media_count ?? null,
      recorded_at: new Date().toISOString(),
    };

    await sb.from("ig_follower_history").upsert(row, { onConflict: "date" });

    // Alert if significant change
    if (change !== 0) {
      const emoji = change > 0 ? "📈" : "📉";
      const sign = change > 0 ? "+" : "";
      await sendTelegram(
        `${emoji} <b>Instagram Followers</b>\n\n` +
        `Today: <b>${currentFollowers.toLocaleString()}</b>\n` +
        `Change: <b>${sign}${change}</b> vs yesterday\n` +
        `Posts: ${json.media_count || 0}`
      );
    }

    return NextResponse.json({ ok: true, snapshot: row, change });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "fetch failed" }, { status: 502 });
  }
}
