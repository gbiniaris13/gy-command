// src/lib/helm/proposal-token.ts
// =============================================================
// Signed, non-guessable token for LINK-delivered proposals, so a
// shared PDF link can be a tracked redirect (/p/<token>) instead of
// a raw signed Supabase URL. Mirrors the HMAC pattern in
// src/lib/greetings.ts.
//
//   token = base64url(id) + "." + base64url(hmac-sha256(id))
//
// Reuses CRON_SECRET (server-only, already present) so no new env var
// is required. HELM_LINK_SECRET overrides if set. A tampered or
// malformed token verifies to null and the route answers 404.
// =============================================================

import { createHmac, timingSafeEqual } from "node:crypto";

// HMAC key. CRON_SECRET is the established server secret across the
// cron routes; falls back to OUTREACH_SECRET, then a dev default.
const SECRET =
  process.env.HELM_LINK_SECRET ||
  process.env.CRON_SECRET ||
  process.env.OUTREACH_SECRET ||
  "gy-helm-link-dev";

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function sign(id: string): string {
  return createHmac("sha256", SECRET).update(id).digest("base64url");
}

/** Tamper-proof token encoding a request id for /p/<token>. */
export function proposalToken(requestId: string): string {
  return `${b64url(requestId)}.${sign(requestId)}`;
}

/** Verify a token and return the request id, or null if tampered/malformed. */
export function verifyProposalToken(token: string): string | null {
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  let id: string;
  try {
    id = Buffer.from(token.slice(0, i), "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!id) return null;
  const sig = token.slice(i + 1);
  const expected = sign(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? id : null;
}
