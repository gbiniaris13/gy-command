import { createServiceClient } from "./supabase-server";

// ─── Settings helpers ────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", key)
    .single();
  return data?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const sb = createServiceClient();
  await sb.from("settings").upsert({ key, value, updated_at: new Date().toISOString() });
}

// ─── Google OAuth config ─────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "577946473201-48bvc1l6e0p1d3ujt7f5aq7or831agkm.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "https://command.georgeyachts.com/api/auth/gmail/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
].join(" ");

export function getGoogleAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ─── Access token from refresh token ─────────────────────────────────────────

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ token: string; expiresIn: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return {
    token: data.access_token as string,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 3600,
  };
}

// In-memory cache for the Google access token. Google access tokens are
// valid for ~60 min and the previous getAccessToken hit oauth2.googleapis
// .com on EVERY Gmail/Calendar call — for crons that fire every 5 min
// (gmail-poll-replies) that's hundreds of redundant OAuth calls per day,
// each one a chance for a transient 5xx to bubble up as a cron 500.
//
// Cache the token in module scope until ~5 min before its real expiry so
// we always have a fresh-enough token in hand. The lambda may recycle the
// module between invocations — that's fine, we just refresh fresh.
let _cachedAccessToken: { token: string; expiresAtMs: number } | null = null;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_cachedAccessToken && now < _cachedAccessToken.expiresAtMs) {
    return _cachedAccessToken.token;
  }
  const refreshToken = await getSetting("gmail_refresh_token");
  if (!refreshToken) {
    throw new Error("Gmail not connected — no refresh token found");
  }
  const { token, expiresIn } = await refreshAccessToken(refreshToken);
  _cachedAccessToken = {
    token,
    expiresAtMs: now + expiresIn * 1000 - TOKEN_REFRESH_MARGIN_MS,
  };
  return token;
}

// Test helper — invalidate cache so a subsequent call definitely hits
// oauth2.googleapis.com. Used by the system-health-check cron when it
// needs to confirm the refresh token still works rather than just
// confirming we have one cached.
export function _invalidateAccessTokenCache(): void {
  _cachedAccessToken = null;
}

// ─── Gmail API helpers ───────────────────────────────────────────────────────

export async function gmailFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken();
  const url = endpoint.startsWith("https://")
    ? endpoint
    : `https://gmail.googleapis.com/gmail/v1/users/me${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

// ─── Calendar API helpers ────────────────────────────────────────────────────

export async function calendarFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken();
  const url = endpoint.startsWith("https://")
    ? endpoint
    : `https://www.googleapis.com/calendar/v3${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}
