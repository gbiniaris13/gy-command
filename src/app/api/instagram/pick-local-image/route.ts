// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";

// POST /api/instagram/pick-local-image
// Body: { caption: string, reserve?: boolean }
//
// Picks the best ROBERTO IG photo for a given caption. Flow:
//   1. Pull all unused photos (used_in_post_id IS NULL)
//   2. If 0 unused, refuse — George needs to upload more (NEVER reuse,
//      per the brief's "ΠΟΤΕ duplicate" rule)
//   3. If caption provided, ask Gemini to pick the photo whose
//      description best matches the caption mood/content, returning
//      the photo's id
//   4. Return the matched photo. If reserve=true, mark its
//      used_in_post_id immediately so a second caller can't race us
//      onto the same image
//
// Fall-back chain when AI matching fails:
//   a) The photo whose tags overlap most with heuristic keywords
//      extracted from the caption
//   b) The most recently uploaded unused photo (freshest content)

interface PhotoRow {
  id: string;
  filename: string;
  public_url: string;
  description: string | null;
  tags: string[] | null;
}

function heuristicScore(caption: string, photo: PhotoRow): number {
  const capLower = caption.toLowerCase();
  const tags = (photo.tags ?? []).map((t) => t.toLowerCase());
  let score = 0;
  for (const tag of tags) {
    if (capLower.includes(tag)) score += 2;
  }
  const desc = (photo.description ?? "").toLowerCase();
  // Token overlap — crude but useful
  const capTokens = new Set(
    capLower.split(/\s+/).filter((w) => w.length > 3)
  );
  for (const word of desc.split(/\s+/)) {
    if (capTokens.has(word.replace(/[^a-z]/g, ""))) score += 1;
  }
  return score;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const caption = (body.caption ?? "").toString().trim();
  const reserve = body.reserve === true;

  const sb = createServiceClient();
  const { data: photos, error } = await sb
    .from("ig_photos")
    .select("id, filename, public_url, description, tags, uploaded_at")
    .is("used_in_post_id", null)
    .order("uploaded_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!photos || photos.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No unused photos in ROBERTO IG library. Upload more via the dashboard before posting.",
      },
      { status: 404 }
    );
  }

  // Step 1 — AI match if we have a caption
  let picked: PhotoRow | null = null;
  let matchReason = "default: most recent unused";

  if (caption && photos.length > 1) {
    try {
      const shortlist = photos.slice(0, 30).map((p) => ({
        id: p.id,
        description: p.description ?? p.filename,
        tags: p.tags ?? [],
      }));
      const prompt = `You are matching an Instagram caption to the best photo from a library. Return ONLY the photo ID that fits best.

CAPTION:
${caption.slice(0, 1200)}

PHOTOS (id · description · tags):
${shortlist.map((p) => `- ${p.id} · ${p.description} · [${p.tags.join(", ")}]`).join("\n")}

Reply with ONLY the photo id from the list above. No quotes, no prose, no markdown.`;

      const raw = await aiChat(
        "You return only a single photo id from the provided list. No extra words.",
        prompt
      );
      const idMatch = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (idMatch) {
        picked = photos.find((p) => p.id === idMatch[0]) ?? null;
        if (picked) matchReason = "ai_match";
      }
    } catch {
      // fall through to heuristic
    }
  }

  // Step 2 — Heuristic tag/description scoring
  if (!picked && caption) {
    const scored = photos
      .map((p) => ({ p, score: heuristicScore(caption, p) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0] && scored[0].score > 0) {
      picked = scored[0].p;
      matchReason = `heuristic_score=${scored[0].score}`;
    }
  }

  // Step 3 — Default: most recently uploaded unused photo
  if (!picked) {
    picked = photos[0];
  }

  // Reserve the photo if asked (so a second caller can't grab it)
  if (reserve && picked) {
    await sb
      .from("ig_photos")
      .update({ used_in_post_id: body.post_id ?? null })
      .eq("id", picked.id)
      .is("used_in_post_id", null);
  }

  return NextResponse.json({
    ok: true,
    photo: picked,
    image_url: picked.public_url,
    match_reason: matchReason,
    available_count: photos.length,
  });
}
