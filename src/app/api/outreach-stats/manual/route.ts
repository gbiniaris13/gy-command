// @ts-nocheck
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { createServiceClient } from "@/lib/supabase-server";

// Dashboard-only endpoint for manually updating the outreach stats snapshot.
// Requires an authenticated Supabase session (dashboard cookie). The public
// /api/outreach-stats POST still exists for bot automation via SYNC_SECRET.

const STATS_KEY = "outreach_stats";

export async function POST(request: NextRequest) {
  try {
    // Authenticate using the dashboard session cookie.
    const cookieStore = await cookies();
    const authed = createServerSupabaseClient(cookieStore);
    const { data: userData, error: userError } = await authed.auth.getUser();
    if (userError || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const n = (v: unknown): number => {
      const num = Number(v);
      return Number.isFinite(num) && num >= 0 ? Math.round(num) : 0;
    };

    const payload = {
      total_sent: n(body.total_sent),
      opens: n(body.opens),
      replies: n(body.replies),
      bounces: n(body.bounces),
      leads_remaining: n(body.leads_remaining),
      active_followups: n(body.active_followups),
      updated_at: new Date().toISOString(),
      source: "manual" as const,
      updated_by: userData.user.email ?? userData.user.id,
    };

    // Use the service client so the upsert bypasses RLS — the session
    // check above already authorised the caller.
    const sb = createServiceClient();
    const { error } = await sb
      .from("settings")
      .upsert(
        {
          key: STATS_KEY,
          value: JSON.stringify(payload),
          updated_at: payload.updated_at,
        },
        { onConflict: "key" }
      );

    if (error) {
      return NextResponse.json(
        { error: "Failed to persist snapshot", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, stats: payload });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
