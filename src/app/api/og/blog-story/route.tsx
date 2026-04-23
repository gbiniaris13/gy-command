// Generated Instagram Story image with text burned in.
//
// IG Graph API does not let us write text / add stickers onto a Story
// after posting (UI-only features). So we pre-compose the Story image
// with the title + CTA burned in using Next's built-in ImageResponse
// (which uses @vercel/og under the hood). The returned PNG is a
// 1080x1920 portrait canvas fetched directly by Instagram when we
// publish the story container.
//
// Called as /api/og/blog-story?slug=<article-slug>. The blog fetcher
// resolves slug → article, pulls og:image + title, and we render a
// georgeyachts.com-branded overlay on top of a dark-gradient-faded
// version of the cover photo.

import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { fetchArticle, listBlogArticles } from "@/lib/blog-fetcher";

export const runtime = "edge";

const BLOG_ROOT = "https://georgeyachts.com";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return new Response("missing ?slug=", { status: 400 });
  }

  let article = null;
  try {
    article = await fetchArticle(`${BLOG_ROOT}/blog/${slug}`);
  } catch {
    // Fallback: resolve via sitemap
    const all = await listBlogArticles().catch(() => []);
    article = all.find((a) => a.slug === slug) ?? null;
  }

  if (!article) {
    return new Response("article not found", { status: 404 });
  }

  const cover = article.coverImageUrl || "";
  const title = article.title || "";
  // Two-line title max for readability at story size.
  const titleDisplay = title.length > 110 ? title.slice(0, 107) + "…" : title;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1080px",
          height: "1920px",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          background: "#0a0a0a",
          fontFamily: "Georgia, serif",
        }}
      >
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            width={1080}
            height={1920}
            style={{
              position: "absolute",
              inset: 0,
              width: "1080px",
              height: "1920px",
              objectFit: "cover",
              opacity: 0.78,
            }}
          />
        )}
        {/* Dark gradient overlay — darker at bottom where text sits */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.92) 100%)",
          }}
        />

        {/* Top: small brand line */}
        <div
          style={{
            position: "absolute",
            top: "84px",
            left: "84px",
            right: "84px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "#F5F1E8",
            fontSize: "30px",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            fontFamily: "Helvetica, Arial, sans-serif",
          }}
        >
          <span style={{ fontWeight: 500 }}>George Yachts Journal</span>
          <span style={{ opacity: 0.75 }}>New article</span>
        </div>

        {/* Main text block: title + CTA */}
        <div
          style={{
            position: "absolute",
            left: "84px",
            right: "84px",
            bottom: "180px",
            display: "flex",
            flexDirection: "column",
            color: "#F9F5EC",
          }}
        >
          <div
            style={{
              fontSize: "84px",
              lineHeight: 1.08,
              fontWeight: 500,
              letterSpacing: "-0.01em",
              marginBottom: "48px",
              textShadow: "0 2px 24px rgba(0,0,0,0.45)",
            }}
          >
            {titleDisplay}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
              fontFamily: "Helvetica, Arial, sans-serif",
              fontSize: "36px",
              color: "#C9A35A",
              letterSpacing: "0.04em",
              fontWeight: 600,
            }}
          >
            <span>Read →</span>
            <span style={{ color: "#F9F5EC" }}>georgeyachts.com/blog</span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1920,
      // Cache 24h at the edge — the same slug always renders the same.
      headers: {
        "cache-control": "public, max-age=86400, s-maxage=86400",
      },
    },
  );
}
