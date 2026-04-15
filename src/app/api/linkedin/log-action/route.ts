// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { LINKEDIN_DAILY_LIMITS } from "@/lib/linkedin-safety";

// POST /api/linkedin/log-action
// Body: {
//   action_type: profile_view | connection_request | connection_message
//                | comment | post | catch_up_message | like
//   target_url?: string
//   target_name?: string
//   target_industry?: string
//   content?: string
//   status?: pending_approval | approved | posted | rejected | failed
//   metadata?: object
// }
//
// Records every LinkedIn action Domingo takes. Re-checks the safety
// cap before inserting — if the cap is already reached for this action
// type today, returns 429 Too Many Requests so Domingo aborts.
//
// GET /api/linkedin/log-action?since=YYYY-MM-DD
// Returns the recent action log for audit / dedup.

export async function GET(req: NextRequest) {
  const sb = createServiceClient();
  const { searchParams } = new URL(req.url);
  const since =
    searchParams.get("since") ?? new Date(Date.now() - 7 * 86400000).toISOString();
  const targetUrl = searchParams.get("target_url");

  let q = sb
    .from("linkedin_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .gte("created_at", since)
    .limit(100);

  if (targetUrl) q = q.eq("target_url", targetUrl);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ actions: data ?? [] });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const actionType = body.action_type as keyof typeof LINKEDIN_DAILY_LIMITS;
  if (!actionType || !(actionType in LINKEDIN_DAILY_LIMITS)) {
    return NextResponse.json(
      {
        error: `action_type must be one of: ${Object.keys(LINKEDIN_DAILY_LIMITS).join(", ")}`,
      },
      { status: 400 }
    );
  }

  const sb = createServiceClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Check cap BEFORE inserting. Pending/approved/posted all count;
  // rejected/failed do not.
  const { count: usedToday } = await sb
    .from("linkedin_actions")
    .select("id", { count: "exact", head: true })
    .eq("action_type", actionType)
    .gte("created_at", todayStart.toISOString())
    .not("status", "in", "(rejected,failed)");

  const limit = LINKEDIN_DAILY_LIMITS[actionType];
  if ((usedToday ?? 0) >= limit) {
    return NextResponse.json(
      {
        error: "Daily safety cap reached",
        action_type: actionType,
        used: usedToday ?? 0,
        limit,
      },
      { status: 429 }
    );
  }

  // Dedup against the same target_url being touched in last 7 days
  // for non-view actions — we don't want to comment on the same post
  // twice or message the same person twice in a week.
  if (body.target_url && actionType !== "profile_view") {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: dupes } = await sb
      .from("linkedin_actions")
      .select("id")
      .eq("action_type", actionType)
      .eq("target_url", body.target_url)
      .gte("created_at", weekAgo)
      .not("status", "in", "(rejected,failed)")
      .limit(1);

    if (dupes && dupes.length > 0) {
      return NextResponse.json(
        {
          error: `Already ${actionType} this target in the last 7 days`,
          target_url: body.target_url,
        },
        { status: 409 }
      );
    }
  }

  const row = {
    action_type: actionType,
    target_url: body.target_url ?? null,
    target_name: body.target_name ?? null,
    target_industry: body.target_industry ?? null,
    content: body.content ?? null,
    status: body.status ?? "pending_approval",
    telegram_message_id: body.telegram_message_id ?? null,
    metadata: body.metadata ?? {},
  };

  const { data: inserted, error: insertErr } = await sb
    .from("linkedin_actions")
    .insert(row)
    .select("*")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, action: inserted });
}

// PATCH /api/linkedin/log-action
// Body: { id, status, posted_at? }
// Used to flip pending_approval → posted/rejected after the user
// approves in Telegram and Domingo finishes the browser action.
export async function PATCH(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.id || !body.status) {
    return NextResponse.json(
      { error: "id and status required" },
      { status: 400 }
    );
  }
  const sb = createServiceClient();
  const updates: Record<string, unknown> = { status: body.status };
  if (body.status === "posted") {
    updates.posted_at = body.posted_at ?? new Date().toISOString();
  }
  const { data, error } = await sb
    .from("linkedin_actions")
    .update(updates)
    .eq("id", body.id)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, action: data });
}
