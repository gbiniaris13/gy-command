// Pinterest OAuth — step 1: redirect to the consent screen.
//
// One-off setup. Visit /api/auth/pinterest/start while signed into
// Pinterest as the gy account, grant board:write + pins:write +
// pins:read scopes, get redirected to /api/auth/pinterest/callback
// which prints the refresh_token to copy into Vercel env.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const appId = process.env.PINTEREST_APP_ID;
  if (!appId) {
    return NextResponse.json(
      { error: "Set PINTEREST_APP_ID first" },
      { status: 500 },
    );
  }
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/auth/pinterest/callback`;
  const scope = [
    "boards:read",
    "boards:write",
    "pins:read",
    "pins:write",
    "user_accounts:read",
  ].join(",");
  const url =
    `https://www.pinterest.com/oauth/?` +
    `response_type=code` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=gy-setup`;
  return NextResponse.redirect(url);
}
