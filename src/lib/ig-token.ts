// Single source of truth for the Instagram Graph access token.
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
