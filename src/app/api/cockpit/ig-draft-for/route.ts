// /api/cockpit/ig-draft-for — on-demand DM-draft generator for any
// IG username. POST { username } or GET ?username=<u> →
//   { category, draft_text, profile_data }
//
// Use cases:
//   - George opens Telegram, types a username, gets an instant draft
//   - Future: Telegram bot command /draft @user — same flow
//   - Future: Cockpit UI search-and-draft for any username
//
// Same classification + drafting logic as the daily cron. Difference:
//   1. Single username instead of bulk engagement scan
//   2. Does NOT record in dm_sent (this is preview-only)
//   3. Returns full data structure for downstream UI use
//
// Auth: same as other admin endpoints — public for now (gy-command is
// behind Vercel deployment protection at the platform layer).

import { NextRequest, NextResponse } from "next/server";
import {
  classifyCandidate,
  draftDm,
  type IgEngagementCandidate,
} from "@/lib/ig-engagement-dm";

export const runtime = "nodejs";
export const maxDuration = 60;

const IG_GRAPH = "https://graph.instagram.com/v21.0";

interface BusinessDiscovery {
  username: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  follows_count?: number;
  is_verified?: boolean;
  profile_picture_url?: string;
}

async function lookupProfile(username: string): Promise<BusinessDiscovery | null> {
  const igToken = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_BUSINESS_ID || process.env.IG_USER_ID;
  if (!igToken || !igUserId) return null;
  const cleanedUsername = username.replace(/^@/, "").trim();
  if (!cleanedUsername) return null;
  const url = `${IG_GRAPH}/${igUserId}?fields=business_discovery.username(${encodeURIComponent(cleanedUsername)}){username,name,biography,followers_count,follows_count,is_verified,profile_picture_url}&access_token=${encodeURIComponent(igToken)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = (await r.json()) as { business_discovery?: BusinessDiscovery };
    return j.business_discovery ?? null;
  } catch {
    return null;
  }
}

async function handle(usernameRaw: string, signalContext?: string) {
  const username = usernameRaw.replace(/^@/, "").trim().toLowerCase();
  if (!username) {
    return NextResponse.json({ error: "username required" }, { status: 400 });
  }

  const profile = await lookupProfile(username);

  // If business_discovery failed, the account is likely personal (not
  // business/creator). We can still classify + draft from the username
  // alone — degraded mode but useful.
  const candidate: IgEngagementCandidate = {
    username,
    fullName: profile?.name ?? null,
    bio: profile?.biography ?? null,
    followerCount: profile?.followers_count ?? 0,
    followsCount: profile?.follows_count ?? null,
    isVerified: profile?.is_verified ?? false,
    profilePictureUrl: profile?.profile_picture_url ?? null,
    signal: "manual",
    signalContext: signalContext ?? "manual draft request",
    signalDate: new Date().toISOString(),
  };

  const category = await classifyCandidate(candidate);
  const draftText = category === "unknown" ? null : await draftDm(candidate, category);

  return NextResponse.json({
    username,
    profile_found: !!profile,
    profile_data: profile,
    category,
    draft_text: draftText,
    ig_profile_url: `https://instagram.com/${username}`,
    ig_dm_url: `https://ig.me/m/${username}`,
    note:
      profile == null
        ? "Profile not visible via IG business_discovery (likely personal/private account). Classified + drafted from username + provided signal alone — quality may be lower."
        : null,
    generated_at: new Date().toISOString(),
  });
}

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username") || "";
  const signal = request.nextUrl.searchParams.get("signal") || undefined;
  return handle(username, signal);
}

export async function POST(request: NextRequest) {
  let body: { username?: string; signal?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }
  return handle(body.username || "", body.signal);
}
