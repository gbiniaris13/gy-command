// @ts-nocheck
/**
 * Fleet post caption generation — one prompt per angle.
 *
 * Phase D.1. Every prompt enforces the George Yachts brand voice:
 *   - "We" not "I" (brand, not person)
 *   - Never claim years of personal experience
 *   - Editorial framing, not sales pitch
 *   - Natural spec weave, never bullet lists in the caption body
 *   - Hashtags are NOT in the caption — the caller appends them
 *     after the banned-hashtag guard runs.
 *
 * Tier pricing rule (decided with George):
 *   - `private`   → show the weekly rate range
 *   - `explorer`  → show the weekly rate range (usually "From €X")
 *   - `both`      → show the range
 *   - Anything flagship-tier above €150k/week that already says
 *     "price on request" in the weeklyRatePrice string → respect it.
 */

import { aiChat } from "./ai";
import type { FleetYacht } from "./sanity-fleet";
import type { FleetAngle } from "./fleet-rotation";

const BRAND_SYSTEM =
  "You write Instagram captions for George Yachts (luxury yacht brokerage, Greek waters). Use the brand voice: 'we'/'our team' (never 'I'). Never claim personal years of experience. Editorial, insider, warm — NOT salesy. Return only the caption text, no preface, no hashtags block.";

function describePricing(yacht: FleetYacht): string {
  const raw = (yacht.weeklyRatePrice ?? "").trim();
  if (!raw) return "Price on request.";
  if (/on\s+request/i.test(raw)) return raw;
  return `Weekly rate: ${raw}`;
}

function yachtSpecsLine(yacht: FleetYacht): string {
  // Compact inline spec string the prompts can drop anywhere.
  const parts = [
    yacht.length && `${yacht.length}`,
    yacht.sleeps && `${yacht.sleeps} guests`,
    yacht.cabins && `${yacht.cabins} cabins`,
    yacht.crew && typeof yacht.crew === "string"
      ? `${yacht.crew.split(/[\n,—–-]/)[0].trim()} crew`
      : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

type AngleBuilder = (yacht: FleetYacht) => { prompt: string };

const BUILDERS: Record<FleetAngle, AngleBuilder> = {
  inside_info: (y) => ({
    prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Specs: ${yachtSpecsLine(y) || "n/a"}
Region: ${y.cruisingRegion ?? "Greece"}
${describePricing(y)}

George's Inside Info (use as the hook — this is the single most important source):
"""
${(y.georgeInsiderTip ?? "").trim()}
"""

Write a 3–5 sentence caption:
- Open with the Inside Info angle as the first sentence (paraphrased into a hook, not copy-pasted).
- Weave one or two specs naturally into the second sentence (never a bullet list).
- Mention pricing in passing (the rate line above).
- End with a soft CTA: "DM us or tap the link in bio to plan your week."
- At most one nautical emoji. No hashtags.`,
  }),

  ideal_guest: (y) => ({
    prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Specs: ${yachtSpecsLine(y) || "n/a"}
Region: ${y.cruisingRegion ?? "Greece"}
${describePricing(y)}

Ideal guest profile:
"""
${(y.idealFor ?? "").trim()}
"""

Write a 3–5 sentence caption:
- Open with a line that speaks directly to the ideal guest ("For the family of six who...", "If your week looks like...").
- Name the yacht and one spec in the second sentence.
- Paint one specific scene from the onboard experience that fits that guest (morning deck, sunset anchorage, children's cabin, etc.).
- Mention pricing in passing.
- Soft CTA to DM or link in bio.
- At most one emoji. No hashtags.`,
  }),

  toys_tour: (y) => ({
    prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Specs: ${yachtSpecsLine(y) || "n/a"}
${describePricing(y)}

Water toys & tenders onboard:
${(y.toys ?? []).map((t) => `- ${t}`).join("\n")}

Write a 3–5 sentence caption:
- Open with the appeal of the onboard toys ("The afternoon plan is always written by what's on the swim platform...").
- Weave 3–4 of the actual toys into flowing prose (NOT a bullet list in the caption).
- Mention yacht name + one spec.
- Mention pricing in passing.
- End with a soft CTA: "Save this post or DM us — link in bio."
- One emoji. No hashtags.`,
  }),

  builder_heritage: (y) => ({
    prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Builder / shipyard: ${y.builder ?? "n/a"}
Year built / refit: ${y.yearBuiltRefit ?? "n/a"}
Specs: ${yachtSpecsLine(y) || "n/a"}
${describePricing(y)}

Write a 3–5 sentence caption celebrating the craftsmanship:
- Open with a line about the builder's heritage or the refit year ("A ${y.builder ?? "classic"} hull, refit in ${y.yearBuiltRefit ?? "recent years"}...").
- Mention one thing the builder / shipyard is known for (naval architecture, engineering, design language) — keep it factual.
- Place her in Greek waters in the third sentence.
- Pricing in passing.
- Soft CTA.
- One emoji. No hashtags.`,
  }),

  cruising_canvas: (y) => ({
    prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Cruising region: ${y.cruisingRegion ?? "Greece"}
Specs: ${yachtSpecsLine(y) || "n/a"}
${describePricing(y)}
Category: ${y.category ?? "motor yacht"}

Write a 3–5 sentence caption about the cruising canvas:
- Open with the region as a travel promise, not a location pin ("A week in ${y.cruisingRegion ?? "the Aegean"} rearranges what you think a holiday can be...").
- Suggest 1–2 island / coast ideas a charterer could string together (but keep general — no fake specific itineraries).
- Name the yacht + one spec in a later sentence.
- Pricing in passing.
- Soft CTA.
- One emoji. No hashtags.`,
  }),

  crew_spotlight: (y) => ({
    prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Specs: ${yachtSpecsLine(y) || "n/a"}
${describePricing(y)}

Crew description (use this as source — extract names and roles):
"""
${(y.crew ?? "").trim()}
"""

Write a 3–5 sentence caption that spotlights the crew:
- Open with one specific crew member (name + role from the source above).
- Add one line about what makes that person or the crew as a whole stand out (use the source; don't invent qualifications).
- Place them on the yacht in a scene-setting sentence.
- Pricing in passing.
- Soft CTA.
- One emoji. No hashtags.`,
  }),
};

/**
 * Generate a caption for a yacht × angle. Returns the text only; the
 * caller is expected to run it through the banned-hashtag guard and
 * append its own hashtag block separately.
 */
export async function generateFleetCaption(
  yacht: FleetYacht,
  angle: FleetAngle,
): Promise<string> {
  const builder = BUILDERS[angle];
  if (!builder) {
    throw new Error(`Unknown fleet angle: ${angle}`);
  }
  const { prompt } = builder(yacht);
  const raw = await aiChat(BRAND_SYSTEM, prompt);
  return raw.replace(/^["']|["']$/g, "").trim();
}

/**
 * Fallback caption for when AI generation fails. Keeps the feed alive
 * without publishing a broken post. Uses what we have from the yacht
 * record verbatim.
 */
export function fallbackFleetCaption(
  yacht: FleetYacht,
  angle: FleetAngle,
): string {
  const specs = yachtSpecsLine(yacht);
  const opener =
    angle === "inside_info" && yacht.georgeInsiderTip
      ? yacht.georgeInsiderTip.split(/[.!?]/)[0].trim() + "."
      : angle === "ideal_guest" && yacht.idealFor
        ? `For ${yacht.idealFor.split(/[,.]/)[0].trim().toLowerCase()}.`
        : `${yacht.name} — one of our private charter yachts in ${yacht.cruisingRegion ?? "Greece"}.`;
  return [
    opener,
    specs ? `${yacht.name}${yacht.subtitle ? ` · ${yacht.subtitle}` : ""}: ${specs}.` : yacht.name,
    describePricing(yacht),
    "DM us or tap the link in bio to plan your week.",
  ].join("\n\n");
}

/**
 * Light hashtag block appended to every fleet post. Intentionally
 * small and category-appropriate — the banned-hashtag guard still
 * runs on the full caption before publish.
 */
export function fleetHashtagBlock(yacht: FleetYacht): string {
  const base = [
    "#yachtcharter",
    "#greece",
    "#greekislands",
    "#luxurytravel",
    "#aegean",
    "#charterlife",
    "#privatecharter",
    "#georgeyachts",
    "#mediterranean",
    "#yachtlife",
  ];
  const catTag =
    yacht.category === "sailing-catamarans"
      ? "#sailingcatamaran"
      : yacht.category === "power-catamarans"
        ? "#powercatamaran"
        : yacht.category === "sailing-monohulls"
          ? "#sailingyacht"
          : "#motoryacht";
  return [...base, catTag].join(" ");
}
