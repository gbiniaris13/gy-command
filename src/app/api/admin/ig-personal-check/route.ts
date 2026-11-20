// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { getIgTokenOptional } from "@/lib/ig-token";
import { createServiceClient } from "@/lib/supabase-server";
import { personalAccountId, storyOnAccount, PERSONAL_ID_KEY } from "@/lib/personal-story";

export const maxDuration = 60;

// GET /api/admin/ig-personal-check
//
// Says whether George's own profile can be reached by the publishing token.
//   (nothing)       the Instagram accounts the token can see (through the
//                   Facebook Pages it manages), and which one is configured
//   ?account=<id>   look at one account: username, followers
//   &container=1    also hand Instagram a story for that account WITHOUT
//                   publishing it, to prove stories are accepted there
//                   (Meta's pages disagree on whether Creator accounts may)
// Read-only apart from that unpublished container, which expires by itself.
const GRAPH = "https://graph.facebook.com/v21.0";

async function get(path: string, token: string) {
  try {
    const res = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
    return await res.json();
  } catch (e) {
    return { error: { message: String((e as any)?.message ?? e) } };
  }
}

export async function GET(req: NextRequest) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const token = getIgTokenOptional();
  if (!token) return NextResponse.json({ error: "no token configured" });
  const { searchParams } = new URL(req.url);

  const pages = await get("me/accounts?fields=name,instagram_business_account{id,username,followers_count}&limit=50", token);
  const reachable = (pages?.data ?? [])
    .filter((p: any) => p.instagram_business_account)
    .map((p: any) => ({ page: p.name, id: p.instagram_business_account.id, username: p.instagram_business_account.username, followers: p.instagram_business_account.followers_count }));

  const sb = createServiceClient();
  const { data: row } = await sb.from("settings").select("value").eq("key", PERSONAL_ID_KEY).maybeSingle();
  const out: any = {
    company_account: process.env.IG_BUSINESS_ID ?? null,
    configured_personal_id: row?.value ?? null,
    active: Boolean(await personalAccountId()),
    accounts_the_token_can_reach: reachable,
    pages_error: pages?.error?.message ?? null,
  };

  const account = searchParams.get("account");
  if (account && /^\d{5,}$/.test(account)) {
    out.account = await get(`${account}?fields=username,name,followers_count`, token);
    if (searchParams.get("container") === "1") {
      const { data: last } = await sb.from("ig_posts").select("image_url").eq("status", "published").not("image_url", "is", null).order("published_at", { ascending: false }).limit(1);
      const image = last?.[0]?.image_url;
      out.story_container_test = image ? await storyOnAccount(account, image, { publish: false }) : { error: "no image to test with" };
      out.note = "Nothing was published. The container expires by itself.";
    }
  }
  return NextResponse.json(out);
}
