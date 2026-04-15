// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// GET — return latest competitor snapshots + 7-day delta per account.
export async function GET() {
  const sb = createServiceClient();

  const { data, error } = await sb
    .from("ig_competitors")
    .select("*")
    .order("date", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json(
      { competitors: [], error: error.message },
      { status: 500 }
    );
  }

  // Group by username, keep newest first
  const byUser = new Map<string, any[]>();
  for (const row of data ?? []) {
    const list = byUser.get(row.username) ?? [];
    list.push(row);
    byUser.set(row.username, list);
  }

  const competitors = Array.from(byUser.entries()).map(([username, rows]) => {
    const sorted = rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    const latest = sorted[0];

    // 7-day delta: find first row with date <= latest.date - 7 days
    const latestTs = new Date(latest.date).getTime();
    const weekOld = sorted.find((r) => {
      const t = new Date(r.date).getTime();
      return t <= latestTs - 7 * 86_400_000;
    });

    const followerDelta7d =
      weekOld && latest.followers_count != null && weekOld.followers_count != null
        ? latest.followers_count - weekOld.followers_count
        : null;

    return {
      username,
      latest: {
        date: latest.date,
        followers_count: latest.followers_count,
        media_count: latest.media_count,
        posts_last_30d: latest.posts_last_30d,
        avg_likes_last_5: latest.avg_likes_last_5,
        avg_comments_last_5: latest.avg_comments_last_5,
      },
      followerDelta7d,
      historyCount: sorted.length,
    };
  });

  // Sort biggest first
  competitors.sort(
    (a, b) =>
      (b.latest.followers_count ?? 0) - (a.latest.followers_count ?? 0)
  );

  return NextResponse.json({ competitors });
}
