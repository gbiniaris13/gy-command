// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// Vercel cron — daily snapshot of @georgeyachts follower count.
// Writes one row per (date) into ig_follower_history. The endpoint is
// idempotent on the day (PRIMARY KEY date), so manual triggers during
// the same day overwrite the row instead of duplicating it.

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
      return NextResponse.json(
        { error: `IG API ${res.status}`, body: body.slice(0, 200) },
        { status: 502 }
      );
    }
    const json = await res.json();

    const today = new Date().toISOString().slice(0, 10);
    const row = {
      date: today,
      followers_count: json.followers_count ?? 0,
      follows_count: json.follows_count ?? null,
      media_count: json.media_count ?? null,
      recorded_at: new Date().toISOString(),
    };

    const sb = createServiceClient();
    const { error } = await sb
      .from("ig_follower_history")
      .upsert(row, { onConflict: "date" });

    if (error) {
      return NextResponse.json(
        { error: "Failed to persist", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, snapshot: row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch failed" },
      { status: 502 }
    );
  }
}
