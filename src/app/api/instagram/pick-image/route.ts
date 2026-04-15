// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// GET /api/instagram/pick-image?query=...
//
// Picks a luxury Pexels image for the next Instagram post. Enforces the
// George Yachts photo policy:
//   1. Search queries are LOCKED to the luxury list — generic beaches,
//      selfies, low-quality stock are rejected at source.
//   2. Minimum resolution 1080×1080 (square Instagram feed).
//   3. Square or landscape only — portrait phone shots get filtered.
//   4. Deduplicates against ig_posts.image_url so we never re-use a photo
//      that's already been posted (or scheduled to post).
//   5. Returns the Pexels permalink + photographer credit so the caller
//      can attribute properly.
//
// Requires PEXELS_API_KEY env var. Free tier = 200 req/h, 20k/month.

const LUXURY_QUERIES = [
  "luxury yacht Greece",
  "superyacht Mediterranean",
  "Greek islands aerial",
  "Mykonos yacht",
  "Santorini luxury",
  "Aegean sea sunset yacht",
];

const MIN_DIMENSION = 1080;

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
  };
}

interface PexelsResponse {
  photos?: PexelsPhoto[];
  page?: number;
  per_page?: number;
  total_results?: number;
  error?: string;
}

function pexelsImageUrl(p: PexelsPhoto): string {
  // Use a 1080-wide compressed version — matches what Instagram serves
  // and what the existing scheduled posts already use.
  return `${p.src.original}?auto=compress&cs=tinysrgb&w=1080`;
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "PEXELS_API_KEY not configured in Vercel env vars",
        setup:
          "Sign up at https://www.pexels.com/api/, generate a key, add PEXELS_API_KEY to gy-command on Vercel.",
      },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  // Optional caller-provided query — must still be one of the locked
  // luxury queries. If not in the allow-list we reject and force the
  // caller to use one of ours. If omitted we rotate through the list.
  const requestedQuery = searchParams.get("query");
  let query: string;
  if (requestedQuery) {
    if (!LUXURY_QUERIES.includes(requestedQuery)) {
      return NextResponse.json(
        {
          error: "Query not in allowed luxury list",
          allowed: LUXURY_QUERIES,
        },
        { status: 400 }
      );
    }
    query = requestedQuery;
  } else {
    query = LUXURY_QUERIES[Math.floor(Math.random() * LUXURY_QUERIES.length)];
  }

  // Pull the existing image URLs we've already used so we can dedupe.
  const sb = createServiceClient();
  const { data: usedRows } = await sb
    .from("ig_posts")
    .select("image_url");
  const usedUrls = new Set(
    (usedRows ?? [])
      .map((r) => r.image_url)
      // Normalize on the photo id segment so query-string variants don't
      // sneak duplicates through.
      .map((u) => {
        const m = u && u.match(/photos\/(\d+)/);
        return m ? `pexels:${m[1]}` : u;
      })
      .filter(Boolean)
  );

  // Fetch a page from Pexels and pick the best non-duplicate photo
  // that meets the resolution + orientation rules.
  const pexelsRes = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=40&orientation=landscape&size=large`,
    {
      headers: { Authorization: apiKey },
      cache: "no-store",
    }
  );
  if (!pexelsRes.ok) {
    return NextResponse.json(
      { error: `Pexels API ${pexelsRes.status}` },
      { status: 502 }
    );
  }
  const pexelsJson: PexelsResponse = await pexelsRes.json();
  const photos = pexelsJson.photos ?? [];

  for (const p of photos) {
    if (p.width < MIN_DIMENSION || p.height < MIN_DIMENSION) continue;
    // Square or landscape only — Instagram feed posts work best at 1:1
    // or 4:5; ultra-wide we accept too. Reject portrait phone shots.
    const ratio = p.width / p.height;
    if (ratio < 0.95) continue;

    const dedupeKey = `pexels:${p.id}`;
    if (usedUrls.has(dedupeKey)) continue;

    return NextResponse.json({
      ok: true,
      query,
      image_url: pexelsImageUrl(p),
      width: p.width,
      height: p.height,
      photographer: p.photographer,
      pexels_url: p.url,
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error:
        "No fresh luxury photo found — every candidate either failed the resolution/orientation check or was already used. Try a different query.",
      query,
      tried: photos.length,
    },
    { status: 404 }
  );
}
