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
import { getIgTokenOptional } from "@/lib/ig-token";

const IG_GRAPH = "https://graph.instagram.com/v21.0";

type Result<T> = { ok: true; id?: string; detail?: T } | { ok: false; error: string };

// ── Caption generators ────────────────────────────────────────────────────

const CAPTION_SYSTEM = `
You write short-form social captions for George Yachts, a MYBA yacht
charter brokerage operating in Greek waters (Cyclades / Ionian /
Saronic). George's voice is data-first, honest, specific. He never
uses these words: stunning, iconic, unparalleled, exceptional,
pedigree, curated, experience (as noun), elevate, unlock, leverage,
primed, breathtaking, hidden gem, tailored. No emoji clusters. Max
one emoji per caption, and only from this set: ⛵ 🌊 ⚓ ✨ — used at
the very end only, never mid-sentence.

CRITICAL output contract (violating any of these = broken):
  - Plain text, no markdown, no code fences, no surrounding quotes.
  - FULL caption must be present. Never stop mid-sentence.
  - Must end with a clear call to action and hashtag block as
    specified by the platform brief.
  - Hashtags only from this industry set: #YachtCharter #MYBACharter
    #CycladesCharter #IonianCharter #MediterraneanYachting
    #LuxuryCharter #YachtBrokerage. Pick 4 or 5.
  - Absolutely no consumer-y tags like #YachtLife, #Goals,
    #InstaYacht.
`.trim();

async function generateCaption(
  article: BlogArticle,
  platform: "facebook" | "instagram_feed" | "instagram_story",
): Promise<string> {
  const platformBrief = {
    facebook: `PLATFORM: Facebook Page post.
LENGTH: 120-220 words.
STRUCTURE:
  1. Data-first hook (one strong sentence with a number or concrete contrast).
  2. 2-3 short paragraphs pulled from the article's actual insight.
  3. Close with ONE blank line, then the article URL on its own line
     (Facebook will render a rich preview card off og:image).
  4. Blank line, then 4-5 industry hashtags on a single final line.

The URL MUST be: ${article.url}`,

    instagram_feed: `PLATFORM: Instagram feed caption.
LENGTH: 90-130 words.
REQUIRED STRUCTURE (do not skip any step):
  1. Opening hook: one sentence with the article's strongest number
     or counter-intuitive observation.
  2. 3-5 short lines — one thought each, NOT a paragraph. Use em-dashes
     or bullets for readability.
  3. One "why it matters for yacht charter" line tying the trend to
     Greek waters specifically.
  4. Blank line.
  5. LITERAL TEXT: "Full article → georgeyachts.com/blog"
  6. Blank line.
  7. Hashtag block: 4-5 industry hashtags separated by single spaces.

The URL stays visible but not clickable on IG — readers will type it.`,

    instagram_story: `PLATFORM: Instagram Story caption.
LENGTH: 15-30 words, single paragraph.
STRUCTURE: one tight hook sentence + "Read on georgeyachts.com/blog".
No hashtags, no URL besides the domain mention.`,
  }[platform];

  const userPrompt = `${platformBrief}

ARTICLE TITLE: ${article.title}
ARTICLE URL: ${article.url}
ARTICLE LEAD PARAGRAPHS:
${article.leadParagraphs.slice(0, 4).join("\n\n")}

Write the complete caption now. Do not add any explanation before or
after. Do not wrap in quotes or code fences. Just the caption text.`;

  const raw = await aiChat(CAPTION_SYSTEM, userPrompt, {
    maxTokens: 2000,
    temperature: 0.55,
  });

  return cleanAndGuarantee(raw, article, platform);
}

// Post-processing safety net. We never trust the model to always
// obey the output contract — so we enforce it here by:
//   - stripping markdown / quotes / code fences
//   - detecting truncated output (ends mid-word or without CTA)
//   - appending the required CTA + hashtags if the model forgot them
// Guarantees the caption is never published broken.
function cleanAndGuarantee(
  raw: string,
  article: BlogArticle,
  platform: "facebook" | "instagram_feed" | "instagram_story",
): string {
  let out = (raw || "")
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .replace(/^\s*["']|["']\s*$/g, "")
    .trim();

  // Truncation heuristic: ends with a preposition/article/conjunction
  // mid-phrase (classic max-tokens cutoff).
  const endsMidSentence = /\b(in|on|at|to|of|for|the|a|an|and|or|but|as|by|with|that|which|this|these|those)\s*$/i.test(
    out,
  );
  if (endsMidSentence) {
    // Drop the dangling last sentence fragment so we don't publish half-a-thought.
    out = out.replace(/[^.!?\n]+$/, "").trim();
  }

  const hashtagSet = [
    "#YachtCharter",
    "#MYBACharter",
    "#CycladesCharter",
    "#MediterraneanYachting",
    "#LuxuryCharter",
  ];

  if (platform === "instagram_feed") {
    // Guarantee CTA line present
    if (!/georgeyachts\.com\/blog/i.test(out)) {
      out = `${out}\n\nFull article → georgeyachts.com/blog`;
    }
    // Guarantee hashtag block present
    const hasHashtagBlock = /(^|\n)\s*#\w+(\s+#\w+){2,}/m.test(out);
    if (!hasHashtagBlock) {
      out = `${out}\n\n${hashtagSet.slice(0, 4).join(" ")}`;
    }
  } else if (platform === "facebook") {
    // Ensure the full article URL is literally present (for the link preview).
    if (!out.includes(article.url)) {
      out = `${out}\n\n${article.url}`;
    }
    const hasHashtagBlock = /(^|\n)\s*#\w+(\s+#\w+){2,}/m.test(out);
    if (!hasHashtagBlock) {
      out = `${out}\n\n${hashtagSet.slice(0, 4).join(" ")}`;
    }
  } else if (platform === "instagram_story") {
    if (!/georgeyachts\.com\/blog/i.test(out)) {
      out = `${out}\n\nRead on georgeyachts.com/blog`;
    }
  }

  return out.trim();
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
    // Page ID single-sourced from facebook-client to avoid drift.
    const { FB_PAGE_ID: pageId } = await import("@/lib/facebook-client");
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
  const token = getIgTokenOptional();
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
    if (!article.slug) return { ok: false, error: "no article slug" };
    // IG Graph API blocks text overlays + link stickers on stories
    // (UI-only features). To make the story actually informative we
    // pre-render a 1080x1920 image with the title + CTA burned in,
    // served from our own /api/og/blog-story?slug=... endpoint. IG's
    // fetcher pulls the PNG when creating the container. IG ignores
    // story captions so we don't pass one.
    const origin = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL || "https://gy-command.vercel.app";
    const storyImageUrl = `${origin}/api/og/blog-story?slug=${encodeURIComponent(article.slug)}`;
    return await igCreateAndPublish({
      mediaType: "STORIES",
      imageUrl: storyImageUrl,
    });
  } catch (e: any) {
    return { ok: false, error: e.message ?? "ig story exception" };
  }
}
