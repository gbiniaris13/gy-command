// @ts-nocheck
// Redirect helper — bounces George to TikTok's authorize endpoint with
// the scopes we need. Once TikTok approves the app, George visits
// /api/auth/tiktok/login once, taps Allow on @george.yachts, and the
// callback route stores the token.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const redirectUri =
    process.env.TIKTOK_REDIRECT_URI ||
    "https://gy-command.vercel.app/api/auth/tiktok/callback";
  if (!clientKey) {
    return NextResponse.json({ error: "TikTok not configured" }, { status: 500 });
  }
  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope: "user.info.basic,video.upload,video.publish,video.list",
    redirect_uri: redirectUri,
    state: crypto.randomUUID(),
  });
  const url = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  return NextResponse.redirect(url);
}
