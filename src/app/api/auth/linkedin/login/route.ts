// OAuth login entry — redirects George to LinkedIn consent screen.
//
// One-time setup: George visits this URL once, grants the app the
// required scopes (openid, profile, email, w_member_social,
// r_organization_admin, w_organization_social), and the callback
// route stores the resulting access token in Supabase settings.
//
// Scopes requested:
//   - openid + profile + email       — member identity (George's person urn)
//   - w_member_social                — post to George's personal profile
//   - w_organization_social          — post to George Yachts Company Page
//   - r_organization_admin           — list admin'd organizations to find the org urn
//
// LinkedIn app product requirement:
//   - "Sign In with LinkedIn using OpenID Connect" — free, instant
//   - "Share on LinkedIn"                          — free, instant
//   - "Community Management API"                   — free, instant for
//     admins of their own pages

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        error:
          "Missing LINKEDIN_CLIENT_ID or LINKEDIN_REDIRECT_URI env vars. Configure the LinkedIn app first.",
      },
      { status: 500 },
    );
  }

  const scopes = [
    "openid",
    "profile",
    "email",
    "w_member_social",
    "w_organization_social",
    "r_organization_admin",
    "r_organization_social",
  ].join(" ");

  const state = Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
  });

  const url = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  return NextResponse.redirect(url);
}
