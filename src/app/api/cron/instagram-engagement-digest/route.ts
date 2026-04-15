// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

// Cron: 11:00 UTC daily (= 14:00 Athens in summer).
//
// Feature #5 — Strategic engagement digest.
//
// Why this is a digest instead of true auto-like:
// The Instagram Graph API does NOT expose the home feed (posts from
// accounts you follow) to Instagram Login tokens. business_discovery
// also fails on our token type (returns "nonexisting field" — see the
// competitor-watch cron for the same limitation). Any fully-automated
// like flow would require scraping or a token type we don't have.
//
// Instead we ship the next-best thing: a Telegram digest with direct
// links to the profiles we track, plus the current follower delta so
// George knows at a glance which accounts are moving. One tap on each
// link, 5-10 minutes, done. Domingo (Claude in Chrome) can take over
// the actual liking when George is at the laptop — the digest is the
// consistent nudge.

const HANDLES = [
  "charterworld",
  "burgessyachts",
  "yachtcharterfleet",
  "northropandjohnson",
  "fraseryachts",
];

export async function GET() {
  const sb = createServiceClient();

  // Read the latest daily snapshot per handle so we can include the
  // 7-day follower delta right in the digest line — actionable signal
  // about which competitors are trending up.
  const { data: latest } = await sb
    .from("ig_competitors")
    .select("username, followers_count, posts_last_30d, avg_likes_last_5, date")
    .order("date", { ascending: false })
    .limit(HANDLES.length * 14);

  const byUser = new Map<string, any[]>();
  for (const row of latest ?? []) {
    if (!byUser.has(row.username)) byUser.set(row.username, []);
    byUser.get(row.username)!.push(row);
  }

  const lines: string[] = [
    "👀 <b>Daily competitor engagement digest</b>",
    "<i>Tap through each profile, spend 1-2 min on their latest post, leave a genuine comment or like. 5-10 min total — compound relationship-building.</i>",
    "",
  ];

  for (const handle of HANDLES) {
    const rows = byUser.get(handle) ?? [];
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    const current = rows[0];
    const weekOld = rows.find(
      (r) =>
        new Date(r.date).getTime() <=
        (current ? new Date(current.date).getTime() - 7 * 86400000 : 0)
    );

    const followers = current?.followers_count?.toLocaleString("en-US") ?? "—";
    const deltaRaw =
      current && weekOld
        ? (current.followers_count ?? 0) - (weekOld.followers_count ?? 0)
        : null;
    const delta =
      deltaRaw == null
        ? ""
        : deltaRaw >= 0
          ? ` (+${deltaRaw.toLocaleString("en-US")})`
          : ` (${deltaRaw.toLocaleString("en-US")})`;
    const postsThisMonth = current?.posts_last_30d ?? "?";

    lines.push(
      `• <a href="https://instagram.com/${handle}">@${handle}</a> — ${followers}${delta} · ${postsThisMonth} posts/30d`
    );
  }

  lines.push(
    "",
    `<i>When you're at the Chrome, tell Domingo: "Like the latest post from @charterworld" and I'll walk you through it via the extension.</i>`
  );

  const message = lines.join("\n");

  // Actually send it — graceful no-op if Telegram env vars are missing
  const sent = await sendTelegram(message);

  return NextResponse.json({
    ok: true,
    telegram_sent: sent,
    handles_count: HANDLES.length,
    window: "daily 11:00 UTC",
  });
}
