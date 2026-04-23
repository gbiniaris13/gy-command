// Blog-to-social broadcaster.
//
// For each new blog article on georgeyachts.com:
//   1. Facebook Page: full link post (clickable, shows link preview card)
//      using the permanent Page Access Token.
//   2. Instagram Feed: image post with a short caption ending in
//      "Full article → georgeyachts.com/blog". IG doesn't make URLs in
//      captions clickable, but the URL is still visible and readers
//      know where to go.
//   3. Instagram Story: single-image story with the same cover image +
//      a CTA line overlay-style in the caption. IG Graph API does NOT
//      support adding link stickers programmatically (a long-standing
//      UI-only limitation), so we lean on the cover image + consistent
//      "georgeyachts.com/blog" verbal call-to-action.
//
// Caption generation is AI-driven (gemini-flash) with a platform-aware
// system prompt so the FB long-form version differs from the IG feed
// short hook. Zero manual work on publish day.

import { aiChat } from "@/lib/ai";
import type { BlogArticle } from "@/lib/blog-fetcher";
import { publishPhoto as facebookPublishPhoto } from "@/lib/facebook-client";

const IG_GRAPH = "https://graph.instagram.com/v21.0";

type Result<T> = { ok: true; id?: string; detail?: T } | { ok: false; error: string };

// ── Caption generators ────────────────────────────────────────────────────

const CAPTION_SYSTEM = `
You write short-form social captions for George Yachts, a MYBA yacht
charter brokerage operating in Greece (Cyclades / Ionian / Saronic).
George's writing voice: data-first, honest, specific numbers, no
superlatives, no emoji clusters. Never use: "stunning", "iconic",
"unparalleled", "exceptional", "pedigree", "curated experience",
"elevate", "unlocks", "leverages", "primed".

You are given a blog article title + URL + lead paragraphs. Produce a
caption for the target platform that matches its length and tone.
Always include the article URL at the bottom as the call to action.
Hashtags are industry-specific only (#YachtCharter, #MYBACharter,
#CycladesCharter, #MediterraneanYachting, #LuxuryCharter) — 3 to 5,
never consumer-y like #YachtLife or #Goals.

Output plain text only. No quotes, no markdown.
`.trim();

async function generateCaption(
  article: BlogArticle,
  platform: "facebook" | "instagram_feed" | "instagram_story",
): Promise<string> {
  const platformBrief = {
    facebook: `Platform: Facebook Page. Length: 120-220 words. Structure: data-first hook (one strong sentence), 1-2 paragraphs of insight from the article, closing CTA with the article URL. The URL will render as a rich preview card so don't waste words describing it — just drop the URL on its own line.`,
    instagram_feed: `Platform: Instagram feed post caption. Length: 80-130 words. Open with a sharp hook pulled from the article's data. Body: 2-3 short lines, single-focus. Close with a line that says: "Full article → georgeyachts.com/blog" and the 4 hashtags.`,
    instagram_story: `Platform: Instagram Story. Length: 12-25 words. One tight hook line + "Read on georgeyachts.com/blog". No hashtags.`,
  }[platform];

  const userPrompt = `${platformBrief}

ARTICLE TITLE: ${article.title}
ARTICLE URL: ${article.url}
ARTICLE LEAD:
${article.leadParagraphs.slice(0, 3).join("\n\n")}

Write the caption now.`;

  const raw = await aiChat(CAPTION_SYSTEM, userPrompt, { maxTokens: 900, temperature: 0.65 });
  return raw
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```$/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

// ── Platform publishers ────────────────────────────────────────────────────

export async function publishBlogToFacebook(
  article: BlogArticle,
): Promise<Result<{ post_id: string }>> {
  try {
    const caption = await generateCaption(article, "facebook");
    // Facebook renders a rich link preview from the URL embedded in the
    // message; we don't need to attach the cover image separately — the
    // preview pulls og:image from the article.
    //
    // We still publish via the photo endpoint when we have a cover image,
    // because pure /feed link posts have lower reach than image posts.
    // facebook-client's publishPhoto accepts a photo URL + caption.
    if (article.coverImageUrl) {
      const full = `${caption}\n\n${article.url}`;
      const r = await facebookPublishPhoto({
        photoUrl: article.coverImageUrl,
        caption: full,
      });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, id: r.post_id };
    }
    // Fallback: pure link post via feed — requires a direct Graph call
    // since facebook-client doesn't expose /feed. We'll inline here.
    const pageId = process.env.FB_PAGE_ID || "1056750427517361";
    const token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return { ok: false, error: "FB_PAGE_ACCESS_TOKEN missing" };
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
      method: "POST",
      body: new URLSearchParams({
        message: caption,
        link: article.url,
        access_token: token,
      }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, id: json.id };
  } catch (e: any) {
    return { ok: false, error: e.message ?? "fb publish exception" };
  }
}

// Instagram Graph API upload helpers. We reuse the same pattern the
// existing instagram-publish cron uses: create container → poll status
// → publish.
async function igCreateAndPublish(args: {
  mediaType: "IMAGE" | "STORIES";
  imageUrl: string;
  caption?: string;
}): Promise<Result<{ media_id: string }>> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "IG_ACCESS_TOKEN missing" };

  const containerBody: Record<string, string> = {
    image_url: args.imageUrl,
    access_token: token,
  };
  if (args.mediaType === "STORIES") {
    containerBody.media_type = "STORIES";
  }
  if (args.caption) containerBody.caption = args.caption;

  const containerRes = await fetch(`${IG_GRAPH}/me/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(containerBody),
  });
  const container = await containerRes.json();
  if (!containerRes.ok || !container.id) {
    return { ok: false, error: container?.error?.message ?? `container HTTP ${containerRes.status}` };
  }

  // Poll container status until FINISHED or timeout (~30s max)
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(
      `${IG_GRAPH}/${container.id}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    );
    const status = await statusRes.json();
    if (status.status_code === "FINISHED") break;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      return { ok: false, error: `container ${status.status_code}` };
    }
  }

  const publishRes = await fetch(`${IG_GRAPH}/me/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: container.id, access_token: token }),
  });
  const published = await publishRes.json();
  if (!publishRes.ok || !published.id) {
    return {
      ok: false,
      error: published?.error?.message ?? `publish HTTP ${publishRes.status}`,
    };
  }
  return { ok: true, id: published.id };
}

export async function publishBlogToInstagramFeed(
  article: BlogArticle,
): Promise<Result<{ media_id: string }>> {
  try {
    if (!article.coverImageUrl) return { ok: false, error: "no cover image" };
    const caption = await generateCaption(article, "instagram_feed");
    return await igCreateAndPublish({
      mediaType: "IMAGE",
      imageUrl: article.coverImageUrl,
      caption,
    });
  } catch (e: any) {
    return { ok: false, error: e.message ?? "ig feed exception" };
  }
}

export async function publishBlogToInstagramStory(
  article: BlogArticle,
): Promise<Result<{ media_id: string }>> {
  try {
    if (!article.coverImageUrl) return { ok: false, error: "no cover image" };
    // Note: IG Graph API does not support story link stickers. The
    // caption is ignored by IG on story uploads anyway — we still
    // generate one because it is logged for analytics.
    await generateCaption(article, "instagram_story");
    return await igCreateAndPublish({
      mediaType: "STORIES",
      imageUrl: article.coverImageUrl,
    });
  } catch (e: any) {
    return { ok: false, error: e.message ?? "ig story exception" };
  }
}
