// OAuth callback — exchanges the code for an access token, fetches
// George's member URN + organizations, and caches everything in
// Supabase settings.linkedin_oauth for the publish crons to use.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";

const LINKEDIN_ORG_ID_HINT = "110876447"; // George Yachts Company Page (from admin URL)

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ error, description: url.searchParams.get("error_description") });
  }
  if (!code) {
    return NextResponse.json({ error: "missing code parameter" }, { status: 400 });
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID!;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI!;

  // 1. Exchange code → access_token
  const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) {
    return NextResponse.json({ error: "token exchange failed", details: tokenJson });
  }
  const accessToken = tokenJson.access_token as string;
  const expiresIn = tokenJson.expires_in as number; // seconds
  const refreshToken = tokenJson.refresh_token as string | undefined;

  // 2. Fetch member identity (sub = LinkedIn member id)
  const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = await meRes.json();
  const memberUrn = `urn:li:person:${me.sub}`;

  // 3. Organization lookup skipped until Community Management API is
  //    approved (the r_organization_admin scope isn't on this token
  //    yet). We hardcode the known org id hint from the admin URL —
  //    it's only used by the future Company Page publish crons, which
  //    are also gated on that approval. Post-approval, re-run OAuth and
  //    this block flips to the live /organizationalEntityAcls query.
  const organizationUrn: string | undefined = `urn:li:organization:${LINKEDIN_ORG_ID_HINT}`;

  // 4. Persist
  const sb = createServiceClient();
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await sb.from("settings").upsert({
    key: "linkedin_oauth",
    value: JSON.stringify({
      access_token: accessToken,
      expires_at: expiresAt,
      refresh_token: refreshToken,
      member_urn: memberUrn,
      organization_urn: organizationUrn,
      connected_at: new Date().toISOString(),
    }),
  });

  await sendTelegram(
    [
      `🔗 <b>LinkedIn connected</b>`,
      `Member: ${me.name ?? me.given_name ?? "unknown"}`,
      `Member URN: <code>${memberUrn}</code>`,
      `Organization: <code>${organizationUrn ?? "(not found)"}</code>`,
      `Token expires: ${expiresAt}`,
    ].join("\n"),
  ).catch(() => {});

  return NextResponse.json({
    ok: true,
    member_urn: memberUrn,
    organization_urn: organizationUrn,
    expires_at: expiresAt,
    next_steps: [
      "Hit /api/cron/linkedin-blog-digest manually to test the Tue/Thu draft flow.",
      "Crons are Tue+Thu 08:45 + 11:00 Athens and Fri 10:00 Athens.",
    ],
  });
}
