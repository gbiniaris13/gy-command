// Facebook Page publishing client.
//
// Posts to the George Yachts corporate Page (ID 61579547047989) via the
// Meta Graph API. Reuses the existing IG_ACCESS_TOKEN — since the IG
// Business account is linked to this Page, one call to /me/accounts
// hands back a Page Access Token we can cache.
//
// We cache the Page token in Supabase `settings` under key
// `fb_page_token` the first time we see it, and refresh lazily if the
// Graph API returns 190 (OAuth token invalid).

import { createServiceClient } from "@/lib/supabase-server";

const GRAPH = "https://graph.facebook.com/v21.0";
const PAGE_ID = process.env.FB_PAGE_ID || "61579547047989";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

async function getPageToken(): Promise<string> {
  const sb = createServiceClient();
  const { data: row } = await sb
    .from("settings")
    .select("value")
    .eq("key", "fb_page_token")
    .maybeSingle();
  if (row?.value) return row.value as string;
  return refreshPageToken();
}

async function refreshPageToken(): Promise<string> {
  const userToken = process.env.IG_ACCESS_TOKEN;
  if (!userToken) throw new Error("IG_ACCESS_TOKEN missing");
  const res = await fetch(`${GRAPH}/me/accounts?access_token=${userToken}`);
  const json = await res.json();
  if (!res.ok) throw new Error(`/me/accounts failed: ${JSON.stringify(json)}`);
  const page = (json.data ?? []).find((p: any) => p.id === PAGE_ID);
  if (!page?.access_token) {
    throw new Error(
      `Page ${PAGE_ID} not found in /me/accounts. Available: ${(json.data ?? [])
        .map((p: any) => `${p.name} (${p.id})`)
        .join(", ")}`
    );
  }
  const sb = createServiceClient();
  await sb
    .from("settings")
    .upsert({ key: "fb_page_token", value: page.access_token });
  return page.access_token;
}

async function callGraph(
  path: string,
  body: Record<string, string>,
  retried = false
): Promise<any> {
  const token = await getPageToken();
  const params = new URLSearchParams({ ...body, access_token: token });
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    body: params,
  });
  const json = await res.json();
  if (res.ok) return json;
  // OAuth token invalid → refresh and retry once.
  if (!retried && json?.error?.code === 190) {
    await refreshPageToken();
    return callGraph(path, body, true);
  }
  throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
}

export async function publishPhoto(args: {
  photoUrl: string;
  caption: string;
}): Promise<Result<{ post_id: string }>> {
  try {
    const json = await callGraph(`/${PAGE_ID}/photos`, {
      url: args.photoUrl,
      caption: args.caption,
      published: "true",
    });
    return { ok: true, post_id: json.post_id ?? json.id };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function publishPhotoCarousel(args: {
  photoUrls: string[];
  caption: string;
}): Promise<Result<{ post_id: string }>> {
  try {
    // Upload each photo unpublished, collect media_fbids, then create
    // one feed post attaching all of them.
    const mediaIds: string[] = [];
    for (const url of args.photoUrls.slice(0, 10)) {
      const up = await callGraph(`/${PAGE_ID}/photos`, {
        url,
        published: "false",
      });
      mediaIds.push(up.id);
    }
    const attached: Record<string, string> = { message: args.caption };
    mediaIds.forEach((id, i) => {
      attached[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
    });
    const post = await callGraph(`/${PAGE_ID}/feed`, attached);
    return { ok: true, post_id: post.id };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function publishVideo(args: {
  videoUrl: string;
  caption: string;
}): Promise<Result<{ post_id: string }>> {
  try {
    const json = await callGraph(`/${PAGE_ID}/videos`, {
      file_url: args.videoUrl,
      description: args.caption,
    });
    return { ok: true, post_id: json.id };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function listPages(): Promise<any> {
  const userToken = process.env.IG_ACCESS_TOKEN;
  if (!userToken) return { error: "IG_ACCESS_TOKEN missing" };
  const res = await fetch(`${GRAPH}/me/accounts?access_token=${userToken}`);
  return res.json();
}
