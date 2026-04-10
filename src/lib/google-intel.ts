// Google authentication helpers for Intel widget data sources.
// - GA4:  uses a service-account JSON (env GA_SERVICE_ACCOUNT_JSON) to sign
//         a JWT with RS256 and exchange it for an OAuth access token.
// - GSC:  reuses the Gmail OAuth refresh token (stored in Supabase settings)
//         which now includes the webmasters.readonly scope.
//
// Both helpers cache tokens in module scope for their full lifetime.

import { createSign } from "node:crypto";
import { getSetting } from "./google-api";

// ─── Service account JWT (GA4) ─────────────────────────────────────────────

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function parseServiceAccount(): ServiceAccount | null {
  const raw = process.env.GA_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    // Vercel env vars lose literal newlines in the private_key — restore them.
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (parsed.private_key?.includes("\\n")) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  } catch {
    return null;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

let cachedGaToken: { token: string; expiresAt: number } | null = null;

export async function getGA4AccessToken(): Promise<string | null> {
  if (cachedGaToken && cachedGaToken.expiresAt > Date.now() + 60_000) {
    return cachedGaToken.token;
  }
  const sa = parseServiceAccount();
  if (!sa) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned =
    base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  let signature: string;
  try {
    signature = base64url(signer.sign(sa.private_key));
  } catch {
    return null;
  }
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  cachedGaToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedGaToken.token;
}

// ─── GSC via existing Gmail OAuth refresh token ────────────────────────────

let cachedGscToken: { token: string; expiresAt: number } | null = null;

export async function getGSCAccessToken(): Promise<string | null> {
  if (cachedGscToken && cachedGscToken.expiresAt > Date.now() + 60_000) {
    return cachedGscToken.token;
  }
  const refreshToken = await getSetting("gmail_refresh_token").catch(() => null);
  if (!refreshToken) return null;

  const clientId =
    process.env.GOOGLE_CLIENT_ID ||
    "577946473201-48bvc1l6e0p1d3ujt7f5aq7or831agkm.apps.googleusercontent.com";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientSecret) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  cachedGscToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedGscToken.token;
}
