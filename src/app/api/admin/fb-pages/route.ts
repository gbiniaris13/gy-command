// Diagnostic: lists the Pages the IG_ACCESS_TOKEN user manages and
// their per-page access tokens. First call also seeds the cached
// Page token in settings.fb_page_token so the mirror cron can run.
//
// Also probes /me to diagnose token-level issues (common failure
// mode: the stored token is IG-Graph-API-scoped and can't call
// /me/accounts).

import { NextResponse } from "next/server";
import { listPages } from "@/lib/facebook-client";

export const runtime = "nodejs";

const GRAPH = "https://graph.facebook.com/v21.0";

export async function GET() {
  const userToken = process.env.IG_ACCESS_TOKEN;
  const tokenInfo = {
    has_token: !!userToken,
    length: userToken?.length ?? 0,
    prefix: userToken?.slice(0, 8) ?? "",
    looks_like_short_lived: userToken?.startsWith("EAA") ?? false,
  };

  // Probe /me — if this works the token is a valid FB User token;
  // if it errors with 190 the token is expired or not a user token.
  let meProbe: any = { skipped: "no token" };
  if (userToken) {
    try {
      const r = await fetch(
        `${GRAPH}/me?fields=id,name&access_token=${userToken}`
      );
      meProbe = await r.json();
    } catch (e: any) {
      meProbe = { error: e.message };
    }
  }

  // Debug-token to inspect scopes.
  let debugToken: any = { skipped: "no token" };
  if (userToken) {
    try {
      const r = await fetch(
        `${GRAPH}/debug_token?input_token=${userToken}&access_token=${userToken}`
      );
      debugToken = await r.json();
    } catch (e: any) {
      debugToken = { error: e.message };
    }
  }

  const pages = await listPages();
  const safePages = {
    ...pages,
    data: (pages.data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      has_access_token: !!p.access_token,
      tasks: p.tasks,
    })),
  };

  return NextResponse.json({
    token: tokenInfo,
    me: meProbe,
    debug_token: debugToken,
    pages: safePages,
  });
}
