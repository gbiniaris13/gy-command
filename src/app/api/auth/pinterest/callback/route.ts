// Pinterest OAuth — step 2: exchange the authorisation code for an
// access_token + refresh_token. The refresh_token is what we paste
// into Vercel env (PINTEREST_REFRESH_TOKEN) — it's long-lived
// (~365 days) and can be refreshed indefinitely.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return NextResponse.json({ error: errorParam }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "missing code" }, { status: 400 });
  }

  const appId = process.env.PINTEREST_APP_ID;
  const appSecret = process.env.PINTEREST_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: "Set PINTEREST_APP_ID + PINTEREST_APP_SECRET first" },
      { status: 500 },
    );
  }

  const redirectUri = `${url.origin}/api/auth/pinterest/callback`;
  const basic = Buffer.from(`${appId}:${appSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  let res: Response;
  try {
    res = await fetch("https://api.pinterest.com/v5/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "token-exchange network error", detail: e?.message },
      { status: 502 },
    );
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: "token-exchange failed", status: res.status, detail: json },
      { status: 502 },
    );
  }

  // Render a small HTML page with the values so George can copy
  // them into Vercel env without leaking them through query logs.
  const html = `<!doctype html>
<html><head><title>Pinterest OAuth — Done</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; padding: 32px; max-width: 720px; margin: 0 auto; background: #0D1B2A; color: #F8F5F0; }
  h1 { color: #C9A84C; }
  .card { background: #1B2B3A; padding: 24px; border: 1px solid rgba(201,168,76,0.2); border-radius: 12px; margin: 16px 0; }
  code { background: rgba(0,0,0,0.4); padding: 4px 10px; border-radius: 6px; word-break: break-all; display: block; margin-top: 6px; color: #F4E4B8; }
  .label { color: rgba(248,245,240,0.65); font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; }
</style></head>
<body>
<h1>✅ Pinterest OAuth complete</h1>
<p>Copy these into the <b>george-yachts</b> Vercel project env (Production), then redeploy:</p>
<div class="card">
  <div class="label">PINTEREST_REFRESH_TOKEN</div>
  <code>${escapeHtml(json.refresh_token || "")}</code>
</div>
<div class="card">
  <div class="label">PINTEREST_ACCESS_TOKEN (for reference — auto-refreshes)</div>
  <code>${escapeHtml(json.access_token || "")}</code>
</div>
<p style="opacity:.7">Scope: ${escapeHtml(json.scope || "")} · expires in ${json.expires_in || "?"}s</p>
<p>Next step: hit <code>/api/cron/pinterest-publish</code> manually once after setting the env vars to test.</p>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
