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
import {
  VOICE_GUARDRAILS,
  detectBannedPhrases,
  detectEmojiViolations,
} from "./ai-voice-guardrails";

// ── Brand system prompt (post-live-review corrections 2026-04-20) ──
// Shared VOICE_GUARDRAILS cover pronoun / register / filler phrases /
// pricing apologetics / emoji policy. Fleet-specific rules layer on top.
const BRAND_SYSTEM = `You write Instagram captions for George Yachts (luxury yacht brokerage, Greek waters). UHNW audience: travel advisors, charter clients, yacht enthusiasts.

${VOICE_GUARDRAILS}

FLEET-CAPTION-SPECIFIC RULES:

1. FIRST SENTENCE must begin with the yacht name, yacht type, or a concrete differentiator (e.g. "S/CAT World's End — Fountaine Pajot Galathea 65, 10 guests"). NEVER start with "If", "Imagine", "Picture", or any hypothetical framing. The first 125 characters are the preview before "…more" — spend them on substance.

2. SAVE CTA: near the end, include one of these verbatim variants (rotate naturally):
   - "Save this for your summer planning."
   - "Know someone planning Greek summer? Send them this."
   - "Save for when you're ready to plan your voyage."

3. Editorial, insider, warm. Return ONLY the caption text — no preface, no hashtag block (the caller appends).`;

// Parse the weeklyRatePrice string into an optional per-person line.
// Format the prompt will use: "from €X/week (≈€Y/person for N guests)".
// When pricing is missing or hard to parse, returns the original string
// as a fallback so the prompt never ends up empty.
function describePricing(yacht: FleetYacht): string {
  const raw = (yacht.weeklyRatePrice ?? "").trim();
  if (!raw) return "Price on request.";
  if (/on\s+request/i.test(raw)) return raw;

  // Try to extract the lowest € figure and the guest count for per-person math.
  const priceMatch = raw.replace(/[.,]/g, "").match(/€\s*([0-9]+)/);
  const priceNum = priceMatch ? parseInt(priceMatch[1], 10) : null;
  const sleepsMatch = (yacht.sleeps ?? "").match(/\d+/);
  const guests = sleepsMatch ? parseInt(sleepsMatch[0], 10) : null;

  if (priceNum && priceNum >= 1000 && guests && guests >= 2) {
    const perPerson = Math.round(priceNum / guests);
    const eur = (n: number) => `€${n.toLocaleString("en-US")}`;
    return `Weekly rate: from ${eur(priceNum)}/week (≈${eur(perPerson)}/person for ${guests} guests). Source text: "${raw}".`;
  }

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

// All per-angle prompts enforce the rules in BRAND_SYSTEM above:
//   - First sentence opens with yacht name / type / concrete differentiator
//     (never "If" / "Imagine" / "Picture")
//   - Pricing is quoted straight, no apologetic softening
//   - A save CTA variant appears near the end
// Each prompt below specifies the angle-specific hook + scene and lets
// the system prompt handle the voice guardrails.

const BUILDERS: Record<FleetAngle, AngleBuilder> = {
  inside_info: (y) => ({
    prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Specs: ${yachtSpecsLine(y) || "n/a"}
Region: ${y.cruisingRegion ?? "Greece"}
${describePricing(y)}

George's Inside Info (primary source — do not copy-paste verbatim):
"""
${(y.georgeInsiderTip ?? "").trim()}
"""

Write a 3–5 sentence caption:
- Open with "${y.name}" + a spec or the most striking inside-info detail (first ~125 chars matter — preview cutoff).
- Weave the Inside Info angle into the second or third sentence.
- Mention pricing once in passing (the rate line above, including the per-person figure if provided).
- End with a save CTA variant from the system prompt.
- At most ONE allowed emoji (⛵ 🌊 ⚓ ✨) at the very end, or none.
- No hashtags.`,
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
- Open with "${y.name}" + yacht type + one concrete spec (e.g. "${y.name} — ${y.subtitle ?? y.category ?? "private charter yacht"}, ${y.sleeps ?? ""} guests"). Do NOT start with "If" or "Imagine".
- Address the ideal guest profile directly in the second sentence.
- Paint one scene that fits that guest (morning deck, sunset anchorage, children's cabin, etc.).
- Pricing once in passing, including the per-person figure if provided.
- Save CTA variant near the end.
- At most ONE allowed emoji (⛵ 🌊 ⚓ ✨) at the very end, or none.
- No hashtags.`,
  }),

  toys_tour: (y) => ({
    prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Specs: ${yachtSpecsLine(y) || "n/a"}
${describePricing(y)}

Water toys & tenders onboard:
${(y.toys ?? []).map((t) => `- ${t}`).join("\n")}

Write a 3–5 sentence caption:
- Open with "${y.name}" + the single most striking toy/tender on board (e.g. "${y.name} carries [toy] plus a full swim-platform arsenal...").
- Weave 3–4 of the actual toys into flowing prose (NOT a bullet list).
- Pricing once in passing, with per-person figure if provided.
- Save CTA variant — strongly favor "Save this for your summer planning." for toy-heavy posts.
- At most ONE allowed emoji (⛵ 🌊 ⚓ ✨) at the very end, or none.
- No hashtags.`,
  }),

  builder_heritage: (y) => {
    // Rotating opener templates — pick one deterministically from
    // day-of-year so the same yacht re-posted weeks apart doesn't
    // recycle the same frame. Five templates = 5× less pattern-
    // recognition signal for Meta's similarity detector.
    const OPENER_TEMPLATES = [
      // 0. Spec-first: "${name} — a ${builder} build, ${year}..."
      `Open with: "${y.name} — a ${y.builder ?? "custom"} build${y.yearBuiltRefit ? `, ${y.yearBuiltRefit}` : ""}...". State the build fact first, follow with ONE specific design or engineering detail in the second sentence.`,
      // 1. Workshop-first: focus on the shipyard's concrete identity
      `Open with: "${y.builder ?? "This"} ${y.subtitle ?? "yacht"} now works the Greek coast as ${y.name}...". Tie the shipyard's concrete identity (naval architecture choice, hull form, engine layout — something specific) into the second sentence.`,
      // 2. Timeline-first: year/refit drives the opening
      y.yearBuiltRefit
        ? `Open with: "${y.name} carries ${y.yearBuiltRefit.includes("/") ? "a " + y.yearBuiltRefit.split("/")[1].trim() + " refit" : "the " + y.yearBuiltRefit + " build"} onto her ${y.yearBuiltRefit.split("/")[0]?.trim() ?? "original"} ${y.builder ?? "hull"}...". Let the timeline carry the opening, then name one specific upgrade or original feature that still matters.`
        : `Open with "${y.name} — ${y.subtitle ?? y.builder}...". Put one specific build detail in the opening beat.`,
      // 3. Owner-eye: describe what a charterer will actually notice
      `Open with: "${y.name}'s ${y.category === "sailing-catamarans" ? "deck layout" : y.category === "power-catamarans" ? "twin hulls" : "profile"} reveals the ${y.builder ?? "shipyard"} signature at a glance...". Name the single most distinctive thing about the build that a guest would notice boarding for the first time.`,
      // 4. Comparative: where she sits in the brand's catalogue
      `Open with: "Among the ${y.builder ?? "builder"} fleet in Greek waters, ${y.name} stands apart because...". Give one concrete reason (size class, refit year, unusual spec) — no superlatives, just the fact.`,
    ];
    const tpl =
      OPENER_TEMPLATES[
        Math.abs(
          (y._id ?? "").split("").reduce((a, c) => a + c.charCodeAt(0), 0) +
            Math.floor(Date.now() / 86400000),
        ) % OPENER_TEMPLATES.length
      ];

    return {
      prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Builder / shipyard: ${y.builder ?? "n/a"}
Year built / refit: ${y.yearBuiltRefit ?? "n/a"}
Specs: ${yachtSpecsLine(y) || "n/a"}
${describePricing(y)}

Write a 3–5 sentence caption celebrating the craftsmanship.

OPENER PATTERN FOR THIS POST: ${tpl}

- After the opener, place her in Greek waters in one sentence.
- Pricing once in passing, with per-person figure if provided.
- Save CTA variant near the end.
- At most ONE allowed emoji (⛵ 🌊 ⚓ ✨) at the very end, or none.
- No hashtags.`,
    };
  },

  cruising_canvas: (y) => ({
    prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Cruising region: ${y.cruisingRegion ?? "Greece"}
Specs: ${yachtSpecsLine(y) || "n/a"}
${describePricing(y)}
Category: ${y.category ?? "motor yacht"}

Write a 3–5 sentence caption about the cruising canvas:
- Open with "${y.name}" + the region + one spec (e.g. "${y.name} cruises ${y.cruisingRegion ?? "the Aegean"} at ${y.cabins ?? "multiple"} cabins..."). Do NOT start with "A week in" or "Imagine".
- Suggest 1–2 island / coast ideas that could be strung together — keep general, no fake specific itineraries.
- Pricing once in passing with per-person figure if provided.
- Save CTA variant.
- At most ONE allowed emoji (⛵ 🌊 ⚓ ✨) at the very end, or none.
- No hashtags.`,
  }),

  crew_spotlight: (y) => ({
    prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Specs: ${yachtSpecsLine(y) || "n/a"}
${describePricing(y)}

Crew description (primary source — extract names and roles; do not invent qualifications):
"""
${(y.crew ?? "").trim()}
"""

Write a 3–5 sentence caption that spotlights the crew:
- Open with the yacht name and the most noteworthy crew member (e.g. "${y.name} is run by Captain [name], [role/credential from source]..."). Do NOT start with a hypothetical.
- Add one sentence on what makes the crew stand out (from source only).
- Scene-setting sentence placing them on the yacht.
- Pricing once in passing, with per-person figure if provided.
- Save CTA variant near the end.
- At most ONE allowed emoji (⛵ 🌊 ⚓ ✨) at the very end, or none.
- No hashtags.`,
  }),
};

/**
 * Generate a caption for a yacht × angle. Returns the text only; the
 * caller is expected to run it through the banned-hashtag guard and
 * append its own hashtag block separately.
 *
 * One regeneration retry if the first output trips the banned-phrase
 * detector (filler words that prompt-level rules didn't catch). After
 * one retry we accept whatever we have and let the caller's Telegram
 * alert path flag it — never block a publish on voice polish.
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

  let raw = await aiChat(BRAND_SYSTEM, prompt);
  let cleaned = raw.replace(/^["']|["']$/g, "").trim();

  const banned = detectBannedPhrases(cleaned);
  if (banned.length > 0) {
    // One retry with an explicit callout of what to avoid.
    const retryPrompt = `${prompt}\n\nAVOID these filler words that slipped into the previous attempt: ${banned.join(", ")}. Replace each with a concrete specific.`;
    try {
      raw = await aiChat(BRAND_SYSTEM, retryPrompt);
      cleaned = raw.replace(/^["']|["']$/g, "").trim();
    } catch {
      // Retry failed — keep the first attempt; banned phrases logged by caller.
    }
  }

  return cleaned;
}

/**
 * Quality check on the final caption body. Runs AFTER generation and
 * AFTER the banned-hashtag strip. Reports violations the caller can
 * Telegram without blocking the publish (fail-open).
 */
export function captionVoiceAudit(caption: string): {
  bannedPhrases: string[];
  emojiViolations: string[];
} {
  return {
    bannedPhrases: detectBannedPhrases(caption),
    emojiViolations: detectEmojiViolations(caption),
  };
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
/**
 * Derive up to 2 yacht-specific hashtags from the Sanity `builder`
 * field. Pulled from George's correction 2026-04-20: yacht-specific
 * tags (e.g. #fountainepajot #galathea65) give each post a distinct
 * discovery path for enthusiasts searching a specific make or model.
 *
 * Handling for the typical shapes in our data:
 *   "Fountaine Pajot Power 67" → ["#fountainepajot", "#power67"]
 *   "CRN Yachts (Ferretti Group)" → ["#crnyachts"]
 *   "Sunseeker 75" → ["#sunseeker", "#sunseeker75"]
 *   "Lagoon 78" → ["#lagoon", "#lagoon78"]
 */
function yachtSpecificHashtags(yacht: FleetYacht): string[] {
  const builder = (yacht.builder ?? "").replace(/\([^)]*\)/g, "").trim();
  if (!builder) return [];
  const tokens = builder.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  // Index of first token that starts with a digit — treats it as the
  // model number boundary. Anything before = brand, anything after (or
  // including) = model code.
  const modelStartIdx = tokens.findIndex((t) => /^\d/.test(t));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const tags: string[] = [];
  if (modelStartIdx > 0) {
    const brand = norm(tokens.slice(0, modelStartIdx).join(""));
    const modelCombined = norm(tokens.join(""));
    if (brand.length >= 3) tags.push(`#${brand}`);
    if (modelCombined.length >= 4 && modelCombined !== brand)
      tags.push(`#${modelCombined}`);
  } else {
    // No model number detected — just the whole builder string as a single tag.
    const full = norm(tokens.join(""));
    if (full.length >= 3) tags.push(`#${full}`);
  }
  return tags.slice(0, 2);
}

/**
 * Final hashtag block appended to every fleet post — 10-12 tags total:
 * 8 generic core tags + 1 category tag + up to 2 yacht-specific from builder.
 * Order matters less than volume on IG today, but we lead with the
 * highest-intent tags.
 */
export function fleetHashtagBlock(yacht: FleetYacht): string {
  // Trimmed from 10 to 8 to leave room for the yacht-specific tags
  // without exceeding 12 total (George's cap).
  const core = [
    "#yachtcharter",
    "#greece",
    "#greekislands",
    "#luxurytravel",
    "#aegean",
    "#charterlife",
    "#georgeyachts",
    "#mediterranean",
  ];
  const catTag =
    yacht.category === "sailing-catamarans"
      ? "#sailingcatamaran"
      : yacht.category === "power-catamarans"
        ? "#powercatamaran"
        : yacht.category === "sailing-monohulls"
          ? "#sailingyacht"
          : "#motoryacht";
  const yachtTags = yachtSpecificHashtags(yacht);
  // Dedup in case builder matches category (unlikely but cheap).
  const all = [...core, catTag, ...yachtTags];
  const seen = new Set<string>();
  const deduped = all.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return deduped.slice(0, 12).join(" ");
}
