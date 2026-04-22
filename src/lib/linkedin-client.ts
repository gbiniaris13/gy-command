// LinkedIn Graph API wrapper.
//
// Two post paths:
//   - publishAsMember (personal profile) — uses w_member_social scope.
//     Author is the OAuth'd user (George).
//   - publishAsOrganization (Company Page) — uses w_organization_social
//     scope from the Community Management API product (free, instant
//     approval for pages the user administers). Author is
//     urn:li:organization:{FB_LINKEDIN_ORG_ID}.
//
// Setup requires a one-time OAuth flow at /api/auth/linkedin/login.
// The resulting access token is cached in Supabase settings.linkedin_oauth.

import { createServiceClient } from "@/lib/supabase-server";

const LINKEDIN_API = "https://api.linkedin.com/v2";
const LINKEDIN_REST = "https://api.linkedin.com/rest";
const API_VERSION = "202410"; // LinkedIn API versioning — bump when needed.

type StoredToken = {
  access_token: string;
  expires_at: string; // ISO
  refresh_token?: string;
  member_urn: string; // urn:li:person:{id}
  organization_urn?: string; // urn:li:organization:{id}
};

async function getToken(): Promise<StoredToken> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", "linkedin_oauth")
    .maybeSingle();
  if (!data?.value) {
    throw new Error(
      "linkedin_oauth missing — run OAuth flow at /api/auth/linkedin/login",
    );
  }
  const token =
    typeof data.value === "string"
      ? (JSON.parse(data.value) as StoredToken)
      : (data.value as StoredToken);
  // Check expiry — if within 1 day of expiry, log a warning for now
  // (we'll wire refresh later when LinkedIn rolls out rotating refresh tokens).
  if (new Date(token.expires_at).getTime() - Date.now() < 24 * 3600 * 1000) {
    console.warn(
      "[linkedin-client] access token expires within 24h — refresh needed",
    );
  }
  return token;
}

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

async function postUgc(
  author: string,
  commentary: string,
  accessToken: string,
  mediaUrl?: string,
): Promise<Ok<{ urn: string; share_url: string | null }> | Err> {
  const body = {
    author,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: commentary },
        shareMediaCategory: mediaUrl ? "IMAGE" : "NONE",
        ...(mediaUrl
          ? {
              media: [
                {
                  status: "READY",
                  originalUrl: mediaUrl,
                },
              ],
            }
          : {}),
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };
  const res = await fetch(`${LINKEDIN_API}/ugcPosts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: `LinkedIn ${res.status}: ${JSON.stringify(json).slice(0, 400)}`,
    };
  }
  return {
    ok: true,
    urn: json.id ?? "unknown",
    share_url: null,
  };
}

// Post a reply/comment on an existing post. Used to drop the article
// link in the first comment after the main post (algorithm hack —
// external links in the main body hurt reach).
async function postComment(
  postUrn: string,
  text: string,
  author: string,
  accessToken: string,
): Promise<{ ok: boolean; error?: string }> {
  const body = {
    actor: author,
    object: postUrn,
    message: { text },
  };
  const res = await fetch(`${LINKEDIN_API}/socialActions/${encodeURIComponent(postUrn)}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return { ok: false, error: `comment ${res.status}: ${err.slice(0, 300)}` };
  }
  return { ok: true };
}

export async function publishAsMember(args: {
  commentary: string;
  firstComment?: string;
  mediaUrl?: string;
}): Promise<Ok<{ urn: string }> | Err> {
  const token = await getToken();
  const result = await postUgc(
    token.member_urn,
    args.commentary,
    token.access_token,
    args.mediaUrl,
  );
  if (!result.ok) return result;
  if (args.firstComment) {
    await postComment(
      result.urn,
      args.firstComment,
      token.member_urn,
      token.access_token,
    ).catch(() => {}); // non-fatal
  }
  return { ok: true, urn: result.urn };
}

export async function publishAsOrganization(args: {
  commentary: string;
  mediaUrl?: string;
  orgUrn?: string; // override; defaults to stored org_urn or env
}): Promise<Ok<{ urn: string }> | Err> {
  const token = await getToken();
  const orgUrn =
    args.orgUrn ??
    token.organization_urn ??
    (process.env.LINKEDIN_ORG_URN as string | undefined);
  if (!orgUrn) {
    return {
      ok: false,
      error:
        "No organization URN — set LINKEDIN_ORG_URN env or store organization_urn in linkedin_oauth row",
    };
  }
  const result = await postUgc(orgUrn, args.commentary, token.access_token, args.mediaUrl);
  if (!result.ok) return result;
  return { ok: true, urn: result.urn };
}

export async function whoami(): Promise<any> {
  const token = await getToken();
  const res = await fetch(`${LINKEDIN_API}/userinfo`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  return res.json();
}
