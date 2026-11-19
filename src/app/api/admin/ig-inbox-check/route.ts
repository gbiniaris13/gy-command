// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { getIgTokenOptional } from "@/lib/ig-token";
import { awayNote, isAthensNight } from "@/lib/ig-inbox";

// GET /api/admin/ig-inbox-check
//
// Read-only. Says whether Instagram comments and messages can reach this
// app and whether it could send the two automatic notes: what the token
// is allowed to do, whether the Facebook Page has this app subscribed to
// its events, and whether the inbox can be read at all. Sends nothing.
const GRAPH = "https://graph.facebook.com/v21.0";

async function get(path: string, token: string) {
  try {
    const res = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
    return await res.json();
  } catch (e) {
    return { error: { message: String((e as any)?.message ?? e) } };
  }
}

export async function GET(req: NextRequest) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const token = getIgTokenOptional();
  const pageId = process.env.FB_PAGE_ID;
  const igId = process.env.IG_BUSINESS_ID;
  if (!token) return NextResponse.json({ error: "no token configured" });

  const dbg = await get(`debug_token?input_token=${encodeURIComponent(token)}`, token);
  const scopes: string[] = dbg?.data?.scopes ?? [];
  const page = pageId ? await get(`${pageId}?fields=access_token,instagram_business_account`, token) : null;
  const pageToken = page?.access_token ?? null;
  const subs = pageId && pageToken ? await get(`${pageId}/subscribed_apps`, pageToken) : null;
  const inbox = pageId && pageToken ? await get(`${pageId}/conversations?platform=instagram&limit=1`, pageToken) : null;

  return NextResponse.json({
    token: {
      type: dbg?.data?.type ?? null,
      valid: dbg?.data?.is_valid ?? null,
      expires: dbg?.data?.expires_at ? new Date(dbg.data.expires_at * 1000).toISOString() : "never",
      error: dbg?.error?.message ?? null,
    },
    may: {
      publish: scopes.includes("instagram_content_publish"),
      read_and_answer_comments: scopes.includes("instagram_manage_comments"),
      read_and_send_messages: scopes.includes("instagram_manage_messages"),
      page_messaging: scopes.includes("pages_messaging"),
      read_insights: scopes.includes("instagram_manage_insights"),
    },
    scopes,
    page: {
      configured: Boolean(pageId),
      page_token_obtained: Boolean(pageToken),
      instagram_account_matches: page?.instagram_business_account?.id ? String(page.instagram_business_account.id) === String(igId) : null,
      error: page?.error?.message ?? null,
    },
    webhook_subscription: {
      subscribed_fields: (subs?.data ?? []).flatMap((a: any) => a.subscribed_fields ?? []),
      apps: (subs?.data ?? []).length,
      error: subs?.error?.message ?? null,
    },
    inbox_readable: inbox ? !inbox.error : null,
    inbox_error: inbox?.error?.message ?? null,
    right_now: { athens_night: isAthensNight(new Date()), night_note_would_read: awayNote(new Date()) },
  });
}
