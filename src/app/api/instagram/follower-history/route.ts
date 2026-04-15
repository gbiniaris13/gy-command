// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// GET — return follower history for the dashboard chart, plus a few
// derived metrics (latest count, day-over-day, week-over-week, MoM).

export async function GET() {
  const sb = createServiceClient();

  const { data, error } = await sb
    .from("ig_follower_history")
    .select("date, followers_count, follows_count, media_count")
    .order("date", { ascending: true })
    .limit(365);

  if (error) {
    return NextResponse.json(
      { history: [], error: error.message },
      { status: 500 }
    );
  }

  const history = (data ?? []).map((row) => ({
    date: row.date,
    followers_count: row.followers_count ?? 0,
    follows_count: row.follows_count ?? null,
    media_count: row.media_count ?? null,
  }));

  if (history.length === 0) {
    return NextResponse.json({
      history: [],
      latest: null,
      delta1d: null,
      delta7d: null,
      delta30d: null,
    });
  }

  const latest = history[history.length - 1];
  const findOffsetBack = (days: number) => {
    if (history.length < days + 1) return null;
    return history[history.length - 1 - days];
  };

  const yesterday = findOffsetBack(1);
  const lastWeek = findOffsetBack(7);
  const lastMonth = findOffsetBack(30);

  const deltaFor = (older: typeof yesterday) =>
    older
      ? {
          from: older.followers_count,
          to: latest.followers_count,
          change: latest.followers_count - older.followers_count,
          pct:
            older.followers_count > 0
              ? Math.round(
                  ((latest.followers_count - older.followers_count) /
                    older.followers_count) *
                    10000
                ) / 100
              : null,
        }
      : null;

  return NextResponse.json({
    history,
    latest,
    delta1d: deltaFor(yesterday),
    delta7d: deltaFor(lastWeek),
    delta30d: deltaFor(lastMonth),
  });
}
