// @ts-nocheck
/**
 * Fleet post caption generation — one prompt per angle.
 *
 * Phase D.1. Every prompt enforces the George Yachts brand voice.
 *
 * 2026-11-19 (George, after the Instagram research): fleet captions now
 * speak as George in the first person, but ONLY from what he has already
 * written on the yacht's page (insider tip, ideal for). The model may
 * shape his words; it may not add a view, a memory, a client or a claim
 * of experience. A caption that does is replaced by the plain fallback
 * (inventedExperience in fleet-cards.ts). The call to action and the
 * hashtags are no longer written by the model at all: assembleFleetCaption
 * adds them in code.
 *   - "I" for George's own published views, plain fact otherwise
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
import { sanitizeCaption } from "./caption-sanitizer";
import type { FleetYacht } from "./sanity-fleet";
import type { FleetAngle } from "./fleet-rotation";
import {
  VOICE_GUARDRAILS,
  detectBannedPhrases,
  detectEmojiViolations,
} from "./ai-voice-guardrails";
import { closingLine, fleetHashtags, inventedExperience, shortName } from "./fleet-cards";

// The shared guardrails say "we, never I", ask for a call to action, set
// a magazine register, allow one closing emoji, and suggest crediting a
// remark to "agencies we work with". Fleet captions overrule all five (see
// the header), so those lines are taken out here rather than contradicted
// further down the same prompt.
const FLEET_VOICE = VOICE_GUARDRAILS.split("\n")
  .filter((line) => !/^\s*(PRONOUN|CTA|REGISTER|EMOJI|CLIENT PRIVACY)\b/.test(line))
  .join("\n");

/** No emoji in a fleet caption: the body is no longer the end of the post. */
function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u200D\uFE0F]/gu, "")
    .replace(/[ \t]+([.,!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

// ── Brand system prompt (post-live-review corrections 2026-04-20) ──
// Shared VOICE_GUARDRAILS cover pronoun / register / filler phrases /
// pricing apologetics / emoji policy. Fleet-specific rules layer on top.
const BRAND_SYSTEM = `You write Instagram captions for George Yachts (yacht charter brokerage, crewed yachts by the week, Greek waters only) in the voice of George P. Biniaris, the broker. Readers: people planning a week in Greece for a family or a group, and the travel advisors who plan for them.

${FLEET_VOICE}

VOICE (George's decision, 2026-11-19):
- Write as George, first person singular ("I"). Never "we", "our team", "our fleet".
- You may state a view ONLY if it is in the block "GEORGE'S OWN WORDS" in the request. Rephrase it lightly. Do not add a view, a memory, a client, a voyage, a number or a claim of experience that is not there.
- Where his words give no view, state the fact plainly, without "I".
- He is the broker. Never the owner of the yacht, never her captain.
- REGISTER: plain, specific English, the way a broker talks to a client across a table. Not a brochure and not a magazine. Never write "discerning", "singular", "experience" as a noun for the week, "welcomes", "boasts", "offers", "nestled", "haven", "oasis", "ultimate" or "perfect".
- NO EMOJI anywhere.
- CLIENT PRIVACY: never mention or imply a specific past client, guest or charter. Never credit a remark to anyone ("agencies tell me", "clients say", "captains report"): if George's own words say it, say it as his; if they do not, leave it out.
- Call the yacht by the name given in the request, exactly, with no prefix such as S/Y, M/Y, S/CAT or P/CAT.

FLEET-CAPTION-SPECIFIC RULES:
1. FIRST SENTENCE must begin with the yacht name, yacht type, or a concrete differentiator, and say in plain search words what she is (for example "crewed sailing catamaran", "Greece", the number of guests). NEVER start with "If", "Imagine", "Picture" or a question.
2. NO CALL TO ACTION. Do not invite the reader to save, share, send, DM, message, click, visit or use the link in bio, and do not end on a question. The closing line is added after you.
3. Editorial, insider, warm. Return ONLY the caption text, with no preface and no hashtags.
4. PRICING: quote the weekly rate for the WHOLE yacht only ("from EUR 28,500 per week"). NEVER divide it per person or per guest. This house sells one product, the crewed yacht by the week.
5. PUNCTUATION: never use an em dash or en dash. Use commas, full stops, or a colon. Short sentences over long ones.
6. Every sentence must be COMPLETE. Never trail off. If you run short of room, end one sentence earlier.
7. TRUTH: only facts present in the data provided. Never invent guests, stories, awards, or numbers.`;

// Weekly rate line for the prompt. ONE PRICE, ONE PRODUCT (George,
// 2026-08): the rate is quoted per yacht per week, crewed. The old
// per-person arithmetic ("≈€490/person") shipped in the 2026-09-01
// Perseids post and is exactly the framing this house forbids — never
// reintroduce it.
function describePricing(yacht: FleetYacht): string {
  const raw = (yacht.weeklyRatePrice ?? "").trim();
  if (!raw) return "Price on request.";
  if (/on\s+request/i.test(raw)) return raw;
  return `Weekly rate (whole yacht, crewed): ${raw}. Quote it per week only, never per person.`;
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
- Mention pricing once in passing (the weekly rate for the whole yacht, never per person).
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
- Pricing once in passing, weekly rate for the whole yacht only, never per person.
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
- Pricing once in passing, weekly rate for the whole yacht only, never per person.
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
- Pricing once in passing, weekly rate for the whole yacht only, never per person.
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
- Pricing once in passing, weekly rate for the whole yacht only, never per person.
- Save CTA variant.
- At most ONE allowed emoji (⛵ 🌊 ⚓ ✨) at the very end, or none.
- No hashtags.`,
  }),

  award_winner: (y) => ({
    prompt: `Yacht: ${y.name}${y.subtitle ? ` (${y.subtitle})` : ""}
Specs: ${yachtSpecsLine(y) || "n/a"}
Region: ${y.cruisingRegion ?? "Greece"}
${describePricing(y)}

Documented awards (from official show results — use ONLY these, exactly as written, never embellish or add "award-winning" beyond them):
${(y.awardLines ?? []).map((a) => `- ${a}`).join("\n")}

Write a 3-5 sentence caption:
- Open with "${y.name}" + her single strongest award from the list (name, organiser and year stated plainly).
- IMPORTANT: a line marked [crew award] belongs to the crew of that YEAR. State the year and never imply the current crew won it. A vessel award belongs to the hull and needs no such caveat.
- One sentence on what the award actually recognises, grounded in the specs or region provided.
- Pricing once in passing, weekly rate for the whole yacht only, never per person.
- Save CTA variant near the end.
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
- Pricing once in passing, weekly rate for the whole yacht only, never per person.
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
  // The catalogue prefix (S/CAT, M/Y) is how the fleet is filed, not how
  // anyone speaks of a yacht. The caption uses her name alone.
  const built = builder({ ...yacht, name: shortName(yacht.name) }).prompt;
  // The per-angle prompts were written for the old voice and each asks for
  // a "save CTA". The closing line is now added in code, so those lines go.
  const withoutCta = built
    .split("\n")
    .filter((line) => !/save cta/i.test(line))
    .join("\n");
  const ownWords = [
    (yacht.georgeInsiderTip ?? "").trim() && `Insider tip: ${(yacht.georgeInsiderTip ?? "").trim()}`,
    (yacht.idealFor ?? "").trim() && `Ideal for: ${(yacht.idealFor ?? "").trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = `${withoutCta}

GEORGE'S OWN WORDS (the only source for any opinion or "I" statement; if empty, write plain fact with no "I"):
"""
${ownWords || "(none)"}
"""
- Do not write any call to action, closing invitation or question at the end.`;

  // 4000 output tokens: the 2026-09-02 SEA U caption shipped cut off
  // mid-sentence because the model's reasoning ate into the default
  // 2000-token budget. The sanitizer below is the second net.
  let raw = await aiChat(BRAND_SYSTEM, prompt, { maxTokens: 4000 });
  let cleaned = raw.replace(/^["']|["']$/g, "").trim();

  const banned = detectBannedPhrases(cleaned);
  if (banned.length > 0) {
    // One retry with an explicit callout of what to avoid.
    const retryPrompt = `${prompt}\n\nAVOID these filler words that slipped into the previous attempt: ${banned.join(", ")}. Replace each with a concrete specific.`;
    try {
      raw = await aiChat(BRAND_SYSTEM, retryPrompt, { maxTokens: 4000 });
      cleaned = raw.replace(/^["']|["']$/g, "").trim();
    } catch {
      // Retry failed — keep the first attempt; banned phrases logged by caller.
    }
  }

  // The model may only restate what George has written. If it invented a
  // memory, a client or a record instead, one retry names the fault; if
  // that fails too, the plain fallback (his own first sentence and the
  // yacht's facts) goes out. An invented story under his name is worse
  // than a plain caption.
  let invented = inventedExperience(cleaned);
  if (invented.length > 0) {
    try {
      raw = await aiChat(
        BRAND_SYSTEM,
        `${prompt}\n\nYour previous attempt invented ${invented.join(", ")}. Remove every such statement. Use only GEORGE'S OWN WORDS and the yacht data.`,
        { maxTokens: 4000 },
      );
      cleaned = raw.replace(/^["']|["']$/g, "").trim();
      invented = inventedExperience(cleaned);
    } catch {
      // keep `invented` as is, the fallback below handles it
    }
    if (invented.length > 0) return fallbackFleetCaption(yacht, angle);
  }
  // Dash scrub + incomplete-sentence trim (brand rules, enforced in
  // code because prompts alone kept leaking both).
  return stripEmoji(sanitizeCaption(cleaned));
}

/**
 * The published caption: the body, then the closing line, then three to
 * five hashtags. The closing line rotates by day and is written in code,
 * so the call to action never depends on the model.
 */
export function assembleFleetCaption(body: string, yacht: FleetYacht, now: Date = new Date()): string {
  const dayIndex = Math.floor(now.getTime() / 86_400_000);
  return `${body.trim()}\n\n${closingLine(yacht.name, dayIndex)}\n\n${fleetHashtags(yacht)}`;
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
  const name = shortName(yacht.name);
  // His own first sentence when there is one, the yacht's plain facts
  // otherwise. No call to action here: assembleFleetCaption adds it.
  const tipFirst = (yacht.georgeInsiderTip ?? "").split(/(?<=[.!?])\s/)[0]?.trim();
  const opener = tipFirst && tipFirst.length >= 30
    ? tipFirst
    : `${name}, a crewed yacht for charter in ${yacht.cruisingRegion ?? "Greece"}.`;
  return sanitizeCaption(
    [
      opener,
      specs ? `${name}${yacht.subtitle ? ` · ${yacht.subtitle}` : ""}: ${specs}.` : name,
      (yacht.weeklyRatePrice ?? "").trim() || "Price on request.",
    ].join("\n\n"),
  );
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
  // 2026-09-03 — swapped the three most generic tags (#greece,
  // #luxurytravel, #mediterranean fight millions of posts) for
  // higher-intent charter tags, and added a cruising-region tag so
  // each post gets a discovery path in its actual waters.
  const core = [
    "#yachtcharter",
    "#yachtchartergreece",
    "#greekislands",
    "#crewedyacht",
    "#aegean",
    "#charterlife",
    "#georgeyachts",
    "#luxuryyachtcharter",
  ];
  const region = (yacht.cruisingRegion ?? "").toLowerCase();
  const regionTag = region.includes("ionian")
    ? "#ioniansea"
    : region.includes("cyclad")
      ? "#cyclades"
      : region.includes("saronic")
        ? "#saronicgulf"
        : region.includes("dodecan")
          ? "#dodecanese"
          : region.includes("sporad")
            ? "#sporades"
            : region.includes("crete")
              ? "#crete"
              : null;
  if (regionTag) core.push(regionTag);
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
