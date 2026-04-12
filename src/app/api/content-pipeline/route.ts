// @ts-nocheck
import { NextResponse } from "next/server";

const SANITY_PROJECT_ID = process.env.SANITY_PROJECT_ID || "ecqr94ey";
const SANITY_DATASET = "production";
const SANITY_API_VERSION = "2024-01-01";

async function sanityFetch(query: string) {
  const url = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${SANITY_DATASET}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result;
}

export async function GET() {
  try {
    const [publishedResult, draftResult] = await Promise.all([
      sanityFetch(
        `*[_type == "post" && !(_id in path("drafts.**"))]{title, "slug": slug.current, _createdAt} | order(_createdAt desc)[0..5]`
      ),
      sanityFetch(
        `*[_type == "post" && _id in path("drafts.**")]{title, "slug": slug.current, _createdAt}[0..5]`
      ),
    ]);

    const published = (publishedResult ?? []).map((p: { title: string; slug: string; _createdAt: string }) => ({
      title: p.title,
      slug: p.slug,
      status: "published",
      date: p._createdAt,
    }));

    const drafts = (draftResult ?? []).map((p: { title: string; slug: string }) => ({
      title: p.title,
      slug: p.slug,
      status: "draft",
      date: null,
    }));

    return NextResponse.json({ published, drafts });
  } catch {
    return NextResponse.json({ published: [], drafts: [] });
  }
}
