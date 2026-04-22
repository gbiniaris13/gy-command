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

  // 3. Fetch organizations the member administers (find George Yachts).
  //    Endpoint: /v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR
  let organizationUrn: string | undefined;
  try {
    const orgRes = await fetch(
      "https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const orgJson = await orgRes.json();
    const elements = (orgJson.elements ?? []) as Array<{ organizationalTarget: string }>;
    // Prefer the George Yachts Page if we can match the known id, otherwise first admin org.
    const match = elements.find((e) =>
      e.organizationalTarget?.endsWith(`:${LINKEDIN_ORG_ID_HINT}`),
    );
    organizationUrn = (match ?? elements[0])?.organizationalTarget;
  } catch (e) {
    // Non-fatal — we can still do personal profile posting without this.
    console.error("[linkedin callback] organization lookup failed:", e);
  }

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
