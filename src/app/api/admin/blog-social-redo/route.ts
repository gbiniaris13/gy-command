// One-shot redo endpoint for blog-to-social.
//
// Deletes the three live posts from yesterday's first-run (which had a
// truncated caption on IG and a plain image with no visible text on the
// story), removes the article URL from the dedup set, and re-fires the
// broadcaster with the hardened captions + burned-in story image.
//
// Pass ?url=<article URL> to target a specific article, or leave blank
// to redo the most recently-broadcast one.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

const KEY = "blog_published_to_social";

async function getPublishedSet(): Promise<Set<string>> {
  const sb = createServiceClient();
  const { data } = await sb.from("settings").select("value").eq("key", KEY).maybeSingle();
  try {
    const arr = JSON.parse((data?.value as string) ?? "[]");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function savePublishedSet(set: Set<string>): Promise<void> {
  const sb = createServiceClient();
  await sb.from("settings").upsert({ key: KEY, value: JSON.stringify([...set]) });
}

async function deleteIgMedia(mediaId: string): Promise<{ ok: boolean; detail?: any }> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, detail: "IG_ACCESS_TOKEN missing" };
  const res = await fetch(
    `https://graph.instagram.com/v21.0/${mediaId}?access_token=${encodeURIComponent(token)}`,
    { method: "DELETE" },
  );
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, detail: json };
}

async function deleteFbPost(postId: string): Promise<{ ok: boolean; detail?: any }> {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return { ok: false, detail: "FB_PAGE_ACCESS_TOKEN missing" };
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${postId}?access_token=${encodeURIComponent(token)}`,
    { method: "DELETE" },
  );
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, detail: json };
}

async function probeIgCaption(mediaId: string): Promise<any> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, detail: "IG_ACCESS_TOKEN missing" };
  const res = await fetch(
    `https://graph.instagram.com/v21.0/${mediaId}?fields=id,caption,permalink,media_type,timestamp&access_token=${encodeURIComponent(token)}`,
  );
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, detail: json };
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const deleteFb = request.nextUrl.searchParams.get("fb_post_id");
  const deleteIgFeed = request.nextUrl.searchParams.get("ig_feed_id");
  const deleteIgStory = request.nextUrl.searchParams.get("ig_story_id");
  const probeId = request.nextUrl.searchParams.get("probe_ig");

  const results: any = { deletions: {} };

  if (probeId) {
    results.probe = await probeIgCaption(probeId);
  }

  if (deleteFb) results.deletions.fb = await deleteFbPost(deleteFb);
  if (deleteIgFeed) results.deletions.ig_feed = await deleteIgMedia(deleteIgFeed);
  if (deleteIgStory) results.deletions.ig_story = await deleteIgMedia(deleteIgStory);

  if (url) {
    const set = await getPublishedSet();
    const before = set.size;
    set.delete(url);
    await savePublishedSet(set);
    results.dedup_reset = { removed: url, before, after: set.size };
  }

  // Trigger the broadcaster if the caller requested it.
  if (request.nextUrl.searchParams.get("rerun") === "1") {
    const origin = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://gy-command.vercel.app";
    const res = await fetch(`${origin}/api/cron/blog-to-social`);
    results.rerun = await res.json().catch(() => ({ ok: res.ok }));
  }

  return NextResponse.json(results);
}
