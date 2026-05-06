// Single source of truth for the Instagram Graph access token + the
// host/path Meta accepts for Business-account publishing.
//
// Phase 27g (Forbes-launch day, 2026-05-06) — George got a Telegram
// alert "Invalid OAuth access token - Cannot parse access token" on
// the reel route. Root cause: every IG cron was hitting
// graph.facebook.com/v21.0/me/... (the "Instagram Login API" host)
// which accepts ONLY user-OAuth tokens — Page tokens get rejected
// with that exact error message. Our FB_PAGE_ACCESS_TOKEN is a Page
// token, so the host was wrong.
//
// The correct host for Business-account publishing with a Page token
// is:
//   POST graph.facebook.com/v21.0/{IG_BUSINESS_ID}/media
//   POST graph.facebook.com/v21.0/{IG_BUSINESS_ID}/media_publish
// (Facebook Graph API explicitly documents this as the path that
// accepts Page Access Tokens for IG Business accounts.)
//
// `getIgGraphRoot()` returns the right host+path prefix. The token
// resolver `getIgTokenOptional()` is unchanged — still prefers the
// permanent System User Page token.
//
// Roberto 2026-05-04 — switched from reading `process.env.IG_ACCESS_TOKEN`
// directly in every IG cron to a helper that prefers the permanent
// System User token (`FB_PAGE_ACCESS_TOKEN`) and falls back to the
// user-OAuth token (`IG_ACCESS_TOKEN`).
//
// Why: Meta auto-invalidates EVERY user-OAuth token whenever the
// account holder changes their Instagram password. That used to mean
// George had to manually refresh `IG_ACCESS_TOKEN` after every reset.
// `FB_PAGE_ACCESS_TOKEN` is a System User token — independent from
// the personal user, never expires, immune to password resets.
//
// IG content publishing (POST /{ig_business_id}/media + media_publish)
// works with a Page Access Token as long as the Page is connected to
// the IG Business account and the System User has
// `instagram_basic` + `instagram_content_publish` granted at creation
// time, which is how George set up the Vercel env. The same token
// already drives /api/cron/facebook-mirror successfully (it survived
// the 2026-05-03 password reset while IG_ACCESS_TOKEN died), so we
// know it has the required surface.
//
// Usage:
//   import { getIgToken } from "@/lib/ig-token";
//   const token = getIgToken();        // throws if neither is set
//   const tokenOpt = getIgTokenOptional(); // returns null if neither is set

export function getIgToken(): string {
  const t = getIgTokenOptional();
  if (!t) {
    throw new Error(
      "No IG access token available. Set FB_PAGE_ACCESS_TOKEN (preferred, " +
        "System User permanent) or IG_ACCESS_TOKEN (user OAuth, dies on " +
        "password reset).",
    );
  }
  return t;
}

export function getIgTokenOptional(): string | null {
  // Prefer the System User token — survives password resets.
  const sysUser = (process.env.FB_PAGE_ACCESS_TOKEN || "").trim();
  if (sysUser) return sysUser;
  // Fallback: user OAuth token. Will die after the next password reset.
  const userTok = (process.env.IG_ACCESS_TOKEN || "").trim();
  if (userTok) return userTok;
  return null;
}

/**
 * Returns the Graph API root (host + path prefix up to the IG
 * Business Account ID) that the active token can authenticate
 * against. Page tokens use the Facebook Graph host; user-OAuth IG
 * tokens use the Instagram Graph host.
 *
 * Use it at the top of any cron that publishes to IG:
 *
 *   const root = getIgGraphRoot();
 *   await fetch(`${root}/media`, { ... });
 *   await fetch(`${root}/media_publish`, { ... });
 *
 * Throws if no token + no IG_BUSINESS_ID is configured (shouldn't
 * happen in production — Vercel env_presence check confirms both).
 */
export function getIgGraphRoot(): string {
  const useSysUser = !!(process.env.FB_PAGE_ACCESS_TOKEN || "").trim();
  const igId = (process.env.IG_BUSINESS_ID || "").trim();
  if (useSysUser) {
    if (!igId) {
      throw new Error(
        "FB_PAGE_ACCESS_TOKEN set but IG_BUSINESS_ID missing. The " +
          "Facebook Graph host requires the IG Business Account ID " +
          "in the path — set IG_BUSINESS_ID in Vercel env vars.",
      );
    }
    // Facebook Graph host — Page tokens authenticate here.
    return `https://graph.facebook.com/v21.0/${igId}`;
  }
  // User-OAuth token fallback path: graph.instagram.com/me works
  // because the token's identity IS the IG user. (Note: the sed-swap
  // applied to all routes intentionally kept graph.facebook.com for
  // every Page-token call site — but THIS branch is only reached when
  // FB_PAGE_ACCESS_TOKEN is missing and we fall back to IG_ACCESS_TOKEN,
  // which needs the Instagram host.)
  return "https://graph.instagram.com/v21.0/me";
}

/**
 * Convenience: returns the GET-style URL for fetching one ig_media
 * by its ID (used for status polling). Different host = different
 * media-id path shape, so keep this centralized too.
 */
export function getIgMediaUrl(mediaId: string): string {
  const useSysUser = !!(process.env.FB_PAGE_ACCESS_TOKEN || "").trim();
  if (useSysUser) {
    return `https://graph.facebook.com/v21.0/${mediaId}`;
  }
  // User-OAuth fallback uses Instagram Graph host.
  return `https://graph.instagram.com/v21.0/${mediaId}`;
}
