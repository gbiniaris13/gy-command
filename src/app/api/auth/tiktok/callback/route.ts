// @ts-nocheck
// TikTok OAuth callback — one-time connect for @george.yachts.
//
// Flow:
//   1. George visits /api/auth/tiktok/login (wrapper that redirects to
//      TikTok's authorize endpoint with our client key + scopes).
//   2. TikTok bounces back here with ?code=... after he taps Allow on
//      @george.yachts.
//   3. We exchange the code for access + refresh tokens and persist
//      them in Supabase settings (key='tiktok_oauth').
//   4. From there, every publish call uses getValidAccessToken() which
//      refreshes automatically.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errParam = url.searchParams.get("error");
  if (errParam) {
    return new Response(
      `<h1>TikTok auth error</h1><p>${errParam}</p>`,
      { status: 400, headers: { "content-type": "text/html" } }
    );
  }
  if (!code) {
    return new Response("Missing code", { status: 400 });
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri =
    process.env.TIKTOK_REDIRECT_URI ||
    "https://gy-command.vercel.app/api/auth/tiktok/callback";
  if (!clientKey || !clientSecret) {
    return new Response("TikTok client not configured", { status: 500 });
  }

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  let tokenJson: any = null;
  try {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    tokenJson = await res.json();
  } catch (e) {
    return new Response(`Token exchange failed: ${e}`, { status: 500 });
  }

  if (!tokenJson?.access_token) {
    return new Response(
      `<pre>${JSON.stringify(tokenJson, null, 2)}</pre>`,
      { status: 400, headers: { "content-type": "text/html" } }
    );
  }

  const row = {
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token,
    expires_at: Date.now() + (tokenJson.expires_in ?? 3600) * 1000,
    open_id: tokenJson.open_id,
    scope: tokenJson.scope,
  };
  const sb = createServiceClient();
  await sb
    .from("settings")
    .upsert(
      { key: "tiktok_oauth", value: JSON.stringify(row) },
      { onConflict: "key" }
    );

  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;padding:40px;background:#0b1020;color:#e7ecf2">
<h1 style="color:#d8b65d">TikTok connected</h1>
<p>@george.yachts OAuth stored. Scope: <code>${row.scope}</code></p>
<p>You can close this tab. The publish cron will use this token automatically.</p>
</body></html>`,
    { status: 200, headers: { "content-type": "text/html" } }
  );
}
