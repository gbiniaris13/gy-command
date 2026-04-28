// Blog → all-social broadcaster.
//
// Tue + Thu 17:30 Athens (14:30 UTC). Picks the newest blog article on
// georgeyachts.com that hasn't yet been broadcast, then publishes it to:
//   - Facebook Page (full link, clickable, rich preview)
//   - Instagram Feed (image + caption with visible blog URL)
//   - Instagram Story (image; no clickable link — API limitation)
//   - Telegram digest for LinkedIn personal (existing Tue/Thu 08:45 cron
//     already surfaces the same article earlier in the day; we skip a
//     second LI ping to avoid double-surface)
//   - TikTok: queued for when app approval lands (logged only)
//
// Dedup: settings.blog_published_to_social stores the list of article
// URLs already processed. Each run picks the first unseen article from
// the sitemap (most recent first), broadcasts it, then appends the URL.
//
// Every real broadcast fires a Telegram summary with per-platform
// success / fail counts so George sees exactly what went out.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { pickNextArticleForLinkedIn } from "@/lib/blog-fetcher";
import {
  publishBlogToFacebook,
  publishBlogToInstagramFeed,
  publishBlogToInstagramStory,
} from "@/lib/blog-social-publisher";
import { observeCron } from "@/lib/cron-observer";

export const runtime = "nodejs";
export const maxDuration = 300;

const KEY = "blog_published_to_social";

async function getPublishedUrls(): Promise<Set<string>> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  try {
    const arr = JSON.parse((data?.value as string) ?? "[]");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function addPublishedUrl(url: string): Promise<void> {
  const sb = createServiceClient();
  const current = await getPublishedUrls();
  current.add(url);
  await sb
    .from("settings")
    .upsert({ key: KEY, value: JSON.stringify([...current]) });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function _observedImpl() {
  try {
    const sb = createServiceClient();
    // Flag-gate so George can mute without a redeploy.
    const { data: flag } = await sb
      .from("settings")
      .select("value")
      .eq("key", "blog_to_social_enabled")
      .maybeSingle();
    if (flag?.value === "false") {
      return NextResponse.json({ skipped: "flag_off" });
    }

    const posted = await getPublishedUrls();
    const article = await pickNextArticleForLinkedIn(posted);
    if (!article) {
      return NextResponse.json({ skipped: "no_new_article", already_posted: posted.size });
    }

    // Fire broadcasters in parallel; swallow per-platform errors so one
    // failure doesn't block the others. Catch branch shape matches the
    // publisher Result type so downstream narrowing works in the
    // summary block.
    type PlatformResult =
      | { ok: true; id?: string }
      | { ok: false; error: string };
    const [fb, igFeed, igStory] = (await Promise.all([
      publishBlogToFacebook(article).catch<PlatformResult>((e) => ({
        ok: false,
        error: e?.message ?? "fb exception",
      })),
      publishBlogToInstagramFeed(article).catch<PlatformResult>((e) => ({
        ok: false,
        error: e?.message ?? "ig feed exception",
      })),
      publishBlogToInstagramStory(article).catch<PlatformResult>((e) => ({
        ok: false,
        error: e?.message ?? "ig story exception",
      })),
    ])) as [PlatformResult, PlatformResult, PlatformResult];

    // Always mark the article as broadcast so we don't retry tomorrow
    // even if one platform failed — a partial broadcast is still more
    // useful than looping the same article forever. Per-platform retry
    // is a separate concern for a future observer cron.
    await addPublishedUrl(article.url);

    const lines = [
      `📣 <b>Blog broadcast</b>`,
      `<b>Article:</b> ${escapeHtml(article.title)}`,
      `<b>URL:</b> ${article.url}`,
      ``,
      `FB:     ${fb.ok ? "✅ " + (fb.id ?? "") : "❌ " + escapeHtml(fb.error)}`,
      `IG feed: ${igFeed.ok ? "✅ " + (igFeed.id ?? "") : "❌ " + escapeHtml(igFeed.error)}`,
      `IG story: ${igStory.ok ? "✅ " + (igStory.id ?? "") : "❌ " + escapeHtml(igStory.error)}`,
      `TikTok:  ⏸ queued (awaiting app review)`,
      `LinkedIn: ℹ surfaced via Tue/Thu 08:45 Telegram digest`,
    ];
    await sendTelegram(lines.join("\n")).catch(() => {});

    return NextResponse.json({
      ok: true,
      article: { url: article.url, title: article.title },
      results: { facebook: fb, instagram_feed: igFeed, instagram_story: igStory },
    });
  } catch (e: any) {
    await sendTelegram(
      `⚠️ <b>Blog broadcast crashed</b>\n<code>${escapeHtml((e.message ?? "unknown").slice(0, 400))}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 });
  }
}

export async function GET() {
  return observeCron("blog-to-social", () => _observedImpl());
}
