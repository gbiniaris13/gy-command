// georgeyachts.com/blog article fetcher.
//
// Reads sitemap.xml to discover all /blog/* URLs, fetches the article
// HTML, extracts title + lead paragraphs + publish date. Used by the
// LinkedIn digest crons (Tue/Thu personal-profile draft + Friday
// Company Page amplify) to find articles that haven't been surfaced to
// LinkedIn yet.

const BLOG_ROOT = "https://georgeyachts.com";
const SITEMAP = `${BLOG_ROOT}/sitemap.xml`;

export type BlogArticle = {
  url: string;
  slug: string;
  title: string;
  leadParagraphs: string[];
  fullBody: string;
  publishedAt: string | null;
  coverImageUrl: string | null;
};

type SitemapEntry = {
  url: string;
  lastmod: string | null;
};

async function fetchSitemapBlogUrls(): Promise<SitemapEntry[]> {
  const res = await fetch(SITEMAP, {
    // Revalidate hourly — blog doesn't change faster than that.
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`sitemap ${SITEMAP} returned ${res.status}`);
  const xml = await res.text();
  const entries: SitemapEntry[] = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/g;
  let m;
  while ((m = urlRegex.exec(xml)) !== null) {
    const block = m[1];
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
    const lastmodMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    if (!locMatch) continue;
    const url = locMatch[1].trim();
    if (!url.includes("/blog/")) continue;
    // Skip the /blog index itself
    if (url.replace(/\/$/, "").endsWith("/blog")) continue;
    entries.push({ url, lastmod: lastmodMatch?.[1]?.trim() ?? null });
  }
  return entries;
}

function parseArticleHtml(html: string, url: string): Omit<BlogArticle, "url" | "slug"> {
  // Title: prefer <h1>, fall back to <title>.
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const rawTitle = (h1Match?.[1] ?? titleMatch?.[1] ?? "").trim();
  const title = rawTitle
    .replace(/<[^>]+>/g, "")
    .replace(/\s*\|\s*George Yachts.*$/i, "")
    .trim();

  // Published date: look for <time datetime="...">, meta[name=date], or
  // the visible "Month Day, Year" pattern near the byline.
  const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/);
  const metaDateMatch = html.match(
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|date|publish_date)["'][^>]+content=["']([^"']+)["']/i,
  );
  const publishedAt = timeMatch?.[1] ?? metaDateMatch?.[1] ?? null;

  // Cover image: og:image.
  const ogImageMatch = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/,
  );
  const coverImageUrl = ogImageMatch?.[1] ?? null;

  // Body: grab <article> block if present, otherwise <main>, then strip
  // tags. Keep paragraph breaks.
  const articleBlockMatch =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/) ??
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  const articleHtml = articleBlockMatch?.[1] ?? html;
  const paragraphs = [
    ...articleHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g),
  ]
    .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 40); // drop nav crumbs

  const leadParagraphs = paragraphs.slice(0, 4);
  const fullBody = paragraphs.join("\n\n");

  return { title, leadParagraphs, fullBody, publishedAt, coverImageUrl };
}

export async function fetchArticle(url: string): Promise<BlogArticle> {
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const html = await res.text();
  const parsed = parseArticleHtml(html, url);
  const slug = url.replace(/\/$/, "").split("/").pop() ?? "";
  return { url, slug, ...parsed };
}

export async function listBlogArticles(): Promise<BlogArticle[]> {
  const entries = await fetchSitemapBlogUrls();
  // Sort by lastmod descending (newest first), nulls last.
  entries.sort((a, b) => {
    if (!a.lastmod) return 1;
    if (!b.lastmod) return -1;
    return b.lastmod.localeCompare(a.lastmod);
  });
  // Only fetch the top 20 articles — the older ones aren't relevant for
  // "freshest article for LinkedIn" selection and saves bandwidth.
  const top = entries.slice(0, 20);
  const results: BlogArticle[] = [];
  for (const entry of top) {
    try {
      const article = await fetchArticle(entry.url);
      // Prefer sitemap lastmod over what's in the article HTML — the
      // sitemap is authoritative for freshness ordering.
      if (entry.lastmod && !article.publishedAt) {
        article.publishedAt = entry.lastmod;
      }
      results.push(article);
    } catch (e) {
      // Individual article failure shouldn't kill the batch.
      console.error("[blog-fetcher] article fetch failed:", entry.url, e);
    }
  }
  return results;
}

// Returns the most recently published article that hasn't yet been
// surfaced to LinkedIn (based on a DB-tracked set of seen URLs).
export async function pickNextArticleForLinkedIn(
  alreadyPostedUrls: Set<string>,
): Promise<BlogArticle | null> {
  const articles = await listBlogArticles();
  for (const article of articles) {
    if (!alreadyPostedUrls.has(article.url)) return article;
  }
  return null;
}
