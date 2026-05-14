// Pinterest v5 client — pure-fetch wrapper around the official
// Pinterest API. Free forever (1 000 API calls/day on the public
// tier; we use 1-3 calls per day).
//
// Setup (one-off, manual):
//   1. Create a Pinterest Business account (free)
//   2. Apply for API access at developers.pinterest.com → get
//      app_id + app_secret
//   3. Run OAuth via /api/auth/pinterest/start and grant access
//      to the boards we want to publish to
//   4. The callback handler captures the refresh_token and stores
//      it as PINTEREST_REFRESH_TOKEN in Vercel env
//
// Daily cron uses the refresh_token to mint a short-lived access
// token, then POSTs to /v5/pins.

const API = "https://api.pinterest.com/v5";

interface AccessTokenCache {
  token: string | null;
  expiresAt: number;
}
const _cache: AccessTokenCache = { token: null, expiresAt: 0 };

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function refreshAccessToken(): Promise<string | null> {
  const appId = process.env.PINTEREST_APP_ID;
  const appSecret = process.env.PINTEREST_APP_SECRET;
  const refreshToken = process.env.PINTEREST_REFRESH_TOKEN;
  if (!appId || !appSecret || !refreshToken) return null;
  if (_cache.token && Date.now() < _cache.expiresAt - 60_000) {
    return _cache.token;
  }
  try {
    const basic = Buffer.from(`${appId}:${appSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const res = await fetch(`${API}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      console.error("[pinterest] token refresh failed", res.status, await res.text());
      return null;
    }
    const json = await res.json();
    const accessToken = json.access_token as string | undefined;
    const ttlSec = (json.expires_in as number) || 3600;
    if (!accessToken) return null;
    _cache.token = accessToken;
    _cache.expiresAt = Date.now() + ttlSec * 1000;
    return accessToken;
  } catch (e) {
    console.error("[pinterest] token refresh threw:", e);
    return null;
  }
}

async function callPinterest<T = any>(
  path: string,
  options: { method?: "GET" | "POST" | "DELETE"; body?: any } = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const token = await refreshAccessToken();
  if (!token) {
    return { ok: false, error: "Pinterest not configured (missing env)", status: 0 };
  }
  try {
    const url = path.startsWith("http") ? path : `${API}${path}`;
    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: j?.message ?? j?.code ?? `HTTP ${res.status}`,
        status: res.status,
      };
    }
    return { ok: true, data: j as T };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "fetch failed", status: 0 };
  }
}

export interface PinterestBoard {
  id: string;
  name: string;
  privacy: string;
}

export async function listBoards(): Promise<Result<{ boards: PinterestBoard[] }>> {
  const res = await callPinterest<{ items: PinterestBoard[] }>("/boards");
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, boards: res.data.items ?? [] };
}

export interface PinArgs {
  boardId: string;
  imageUrl: string;
  title: string;
  description?: string;
  link?: string;
  altText?: string;
}

export async function createPin(args: PinArgs): Promise<Result<{ pin_id: string; permalink?: string }>> {
  const body: any = {
    board_id: args.boardId,
    title: args.title.slice(0, 100),
    description: (args.description || "").slice(0, 800),
    media_source: {
      source_type: "image_url",
      url: args.imageUrl,
    },
  };
  if (args.link) body.link = args.link.slice(0, 2048);
  if (args.altText) body.alt_text = args.altText.slice(0, 500);

  const res = await callPinterest<{ id: string; url?: string }>("/pins", {
    method: "POST",
    body,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, pin_id: res.data.id, permalink: res.data.url };
}

/** Diagnostic: does this deployment have everything it needs to publish to Pinterest? */
export function pinterestStatus(): {
  configured: boolean;
  missing: string[];
} {
  const missing = [
    "PINTEREST_APP_ID",
    "PINTEREST_APP_SECRET",
    "PINTEREST_REFRESH_TOKEN",
    "PINTEREST_BOARD_ID",
  ].filter((k) => !process.env[k]);
  return { configured: missing.length === 0, missing };
}
