// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { createServiceClient } from "@/lib/supabase-server";
import {
  GUIDE_DECKS, SHORTLIST_SPECS, buildGuideDeck, buildShortlistDeck, pickDeck, guideCaption, guideAlt,
} from "@/lib/guide-decks";
import { loadGuidePool } from "@/lib/guide-pool";
import { guideOgUrl, renderGuideSlideToUrl } from "@/lib/guide-render";

export const maxDuration = 120;

// GET /api/admin/guide-dryrun
//
// Shows the guide carousel the cron would publish, without publishing.
//   (nothing)          the deck for the current turn
//   ?turn=7            the deck for that turn
//   ?deck=apa          one written guide by id
//   ?shortlist=ten-guests   one live shortlist by id
//   ?render=1          also draws and stores every slide exactly as the
//                      cron does, returning the final addresses. The only
//                      thing this route ever writes.
//   ?list=1            the ids of every deck, and how many yachts each
//                      shortlist would find today
export async function GET(req: NextRequest) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const { searchParams, origin } = new URL(req.url);

  const pool = await loadGuidePool().catch(() => []);

  if (searchParams.get("list") === "1") {
    return NextResponse.json({
      cleared_yachts: pool.length,
      with_exterior_photo: pool.filter((y) => y.exteriors.length > 0).length,
      guides: GUIDE_DECKS.map((d) => d.id),
      shortlists: SHORTLIST_SPECS.map((s) => {
        const built = buildShortlistDeck(s, pool);
        return { id: s.id, yachts: built ? built.yachts : [], publishable: Boolean(built) };
      }),
    });
  }

  let turn: number | null = null;
  let deck;
  const deckId = searchParams.get("deck");
  const shortlistId = searchParams.get("shortlist");
  if (deckId) {
    const d = GUIDE_DECKS.find((g) => g.id === deckId);
    if (!d) return NextResponse.json({ error: `unknown deck ${deckId}`, valid: GUIDE_DECKS.map((g) => g.id) }, { status: 400 });
    deck = buildGuideDeck(d, pool, Number(searchParams.get("turn") ?? 0) || 0);
  } else if (shortlistId) {
    const s = SHORTLIST_SPECS.find((x) => x.id === shortlistId);
    if (!s) return NextResponse.json({ error: `unknown shortlist ${shortlistId}`, valid: SHORTLIST_SPECS.map((x) => x.id) }, { status: 400 });
    deck = buildShortlistDeck(s, pool, Number(searchParams.get("offset") ?? 0) || 0);
    if (!deck) return NextResponse.json({ error: "fewer than three cleared yachts match", shortlist: shortlistId }, { status: 404 });
  } else {
    if (searchParams.get("turn") !== null) {
      turn = Math.max(0, parseInt(searchParams.get("turn") ?? "0", 10) || 0);
    } else {
      const sb = createServiceClient();
      const { data } = await sb.from("settings").select("value").eq("key", "guide_turn_v1").maybeSingle();
      turn = Math.max(0, parseInt(data?.value ?? "0", 10) || 0);
    }
    deck = pickDeck(turn, pool);
  }

  const n = deck.slides.length;
  const slides: any[] = deck.slides.map((slide, i) => ({
    i: i + 1,
    kind: slide.kind,
    preview_url: guideOgUrl(origin, slide, i + 1, n),
    alt: guideAlt(slide),
    slide,
  }));
  if (searchParams.get("render") === "1") {
    for (const s of slides) {
      const started = Date.now();
      s.stored_url = await renderGuideSlideToUrl(origin, s.slide, s.i, n, `preview-${deck.id}`);
      s.stored_ms = Date.now() - started;
    }
  }

  return NextResponse.json({
    turn,
    deck: deck.id,
    kind: deck.kind,
    yachts: deck.yachts,
    first_comment: `The same, at length: ${deck.page}`,
    caption: guideCaption(deck),
    slides,
  });
}
