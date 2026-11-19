// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import {
  fetchFleetPool,
  fetchYachtById,
  buildFleetUTM,
} from "@/lib/sanity-fleet";
import {
  FLEET_ANGLES,
  angleEligibleForYacht,
  eligibleAnglesForYacht,
  selectNextYacht,
  selectAngle,
  loadRotationState,
} from "@/lib/fleet-rotation";
import {
  generateFleetCaption,
  fallbackFleetCaption,
  assembleFleetCaption,
} from "@/lib/fleet-caption";
import { loadShots, orderForCarousel, igFriendlyUrl } from "@/lib/ig-shots";
import { buildCards, planSlides, cardSizeFor, photoAltText, cardAltText } from "@/lib/fleet-cards";
import { cardOgUrl, renderCardToUrl } from "@/lib/fleet-card-render";

// GET /api/admin/fleet-dryrun
//
// Preview a fleet post without publishing. Useful for sanity-checking
// voice, photo selection and eligibility before George flips the
// fleet_posts_enabled flag for real.
//
// Query params (all optional):
//   ?yacht_id=<sanity _id>   — force a specific yacht (default: auto-pick via rotation)
//   ?angle=<inside_info|...> — force a specific angle (default: auto-pick)
//   ?render=1                — also draw the text cards and store them exactly
//                              as the cron does (three small images in the
//                              media store), returning their final addresses.
//                              The one exception to "no writes" below.
//
// Returns: { yacht: {...}, angle, caption, photos[], utm_url,
//            eligible_angles, pool_size }
//
// Read-only. No DB writes, no IG calls. Safe to hit repeatedly.

export async function GET(req: NextRequest) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const forcedYachtId = searchParams.get("yacht_id");
  const forcedAngle = searchParams.get("angle");

  const pool = await fetchFleetPool();
  if (pool.length === 0) {
    return NextResponse.json(
      { error: "Sanity pool is empty (or all yachts have <6 images)" },
      { status: 404 },
    );
  }

  const state = await loadRotationState();

  let yacht;
  if (forcedYachtId) {
    yacht = pool.find((y) => y._id === forcedYachtId);
    if (!yacht) {
      // Try a fresh fetch in case the yacht is outside the pool filter.
      yacht = await fetchYachtById(forcedYachtId);
      if (!yacht) {
        return NextResponse.json(
          { error: `Yacht ${forcedYachtId} not found` },
          { status: 404 },
        );
      }
    }
  } else {
    // As the cron does: only yachts with three known exterior photographs
    // are in the rotation, so the preview picks the yacht the cron would.
    const poolShots = await loadShots(
      pool.flatMap((y) => (y.images ?? []).map((i: any) => i.url).filter((u: any) => typeof u === "string")),
    );
    const ready = pool.filter(
      (y) =>
        (y.images ?? []).filter(
          (i: any) => i?.url && poolShots.get(i.url) === "exterior" && igFriendlyUrl(i.url),
        ).length >= 3,
    );
    yacht = selectNextYacht(ready, state);
    if (!yacht) {
      return NextResponse.json(
        { error: "No eligible yacht (all on cooldown / no valid angles)" },
        { status: 404 },
      );
    }
  }

  const eligible = eligibleAnglesForYacht(yacht);
  const angleEligibilityReport = FLEET_ANGLES.map((a) => ({
    angle: a,
    ...angleEligibleForYacht(yacht, a),
  }));

  let angle = null as any;
  if (forcedAngle) {
    if (!FLEET_ANGLES.includes(forcedAngle as any)) {
      return NextResponse.json(
        { error: `Unknown angle: ${forcedAngle}`, valid: FLEET_ANGLES },
        { status: 400 },
      );
    }
    const check = angleEligibleForYacht(yacht, forcedAngle as any);
    if (!check.eligible) {
      return NextResponse.json(
        {
          error: `Angle '${forcedAngle}' not eligible for ${yacht.name}: ${check.reason}`,
          eligible_angles: eligible,
        },
        { status: 400 },
      );
    }
    angle = forcedAngle;
  } else {
    angle = selectAngle(yacht, state);
    if (!angle) {
      return NextResponse.json(
        { error: `No eligible angle for ${yacht.name}` },
        { status: 404 },
      );
    }
  }

  let captionBody: string;
  try {
    captionBody = await generateFleetCaption(yacht, angle);
    if (!captionBody || captionBody.length < 40) {
      captionBody = fallbackFleetCaption(yacht, angle);
    }
  } catch (err: any) {
    captionBody = fallbackFleetCaption(yacht, angle);
  }
  const caption = assembleFleetCaption(captionBody, yacht);

  // The same selection the cron makes: exteriors first, at most two deck
  // shots, seven photographs, then the text cards placed between them.
  // Cards are returned as preview addresses (drawn on request, not stored).
  const allUrls = (yacht.images ?? []).map((i: any) => i.url).filter((u: any) => typeof u === "string" && u.length > 10);
  const shots = await loadShots(allUrls);
  const photos = orderForCarousel(allUrls.filter(igFriendlyUrl), shots).slice(0, 7);
  const origin = new URL(req.url).origin;
  const cardSize = photos.length ? cardSizeFor(photos[0]) : { width: 1080, height: 720 };
  const slides: any[] = planSlides(photos, buildCards(yacht)).map((slide) =>
    slide.type === "photo"
      ? { type: "photo", url: slide.url, alt: photoAltText(yacht, shots.get(slide.url) ?? null) }
      : { type: "card", kind: slide.card.kind, url: cardOgUrl(origin, slide.card, cardSize), alt: cardAltText(slide.card), card: slide.card },
  );
  if (searchParams.get("render") === "1") {
    for (const s of slides) {
      if (s.type !== "card") continue;
      const started = Date.now();
      s.stored_url = await renderCardToUrl(origin, s.card, cardSize, `preview-${yacht.slug ?? "yacht"}`);
      s.stored_ms = Date.now() - started;
    }
  }

  return NextResponse.json({
    pool_size: pool.length,
    yacht: {
      _id: yacht._id,
      name: yacht.name,
      subtitle: yacht.subtitle,
      fleetTier: yacht.fleetTier,
      category: yacht.category,
      specs: {
        length: yacht.length,
        sleeps: yacht.sleeps,
        cabins: yacht.cabins,
        crew: yacht.crew ? yacht.crew.slice(0, 120) : null,
      },
      weeklyRatePrice: yacht.weeklyRatePrice,
      imageCount: yacht.images?.length ?? 0,
    },
    angle,
    angle_eligibility: angleEligibilityReport,
    eligible_angles: eligible,
    caption,
    caption_body_only: captionBody,
    photos,
    card_size: cardSize,
    slides,
    would_publish: photos.length >= 3,
    utm_url: buildFleetUTM(yacht, angle),
    story_followup_will_fire_at: new Date(
      Date.now() + 48 * 60 * 60 * 1000,
    ).toISOString(),
    story_followup_photo_would_be: yacht.images?.[1]?.url ?? yacht.images?.[0]?.url ?? null,
  });
}
