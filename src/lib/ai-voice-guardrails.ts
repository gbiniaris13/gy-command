// @ts-nocheck
/**
 * Shared brand-voice guardrails for every AI-generated output:
 * fleet captions, comment replies, DM replies, story copy, anything
 * else that writes as "George Yachts". One file, one rulebook.
 *
 * Introduced 2026-04-20 after George flagged filler phrases like
 * "unparalleled backdrop" and "unforgettable moments" slipping into
 * an auto comment reply. Those phrases weaken UHNW credibility —
 * forbidding them everywhere, not just in fleet captions.
 *
 * Pattern:
 *   1. Inject VOICE_GUARDRAILS into every AI system prompt (prepended
 *      to the caller's specific instructions).
 *   2. Post-generation, call detectBannedPhrases() on the output; log
 *      a Telegram warning if anything slipped past the model. Do NOT
 *      mangle the output — just flag for improvement.
 */

// Lowercase-only substring matches. Order doesn't matter.
export const BANNED_FILLER_PHRASES = [
  // Empty luxury superlatives (George 2026-04-20)
  "exceptional",
  "unparalleled",
  "renowned",
  "pedigree",
  "high standards",
  "incredible",
  "stunning",
  "elevated",
  "iconic",
  "unforgettable",
  // Tech / startup vocabulary (register violations)
  "primed for discovery",
  "primed",
  "unlocks",
  "leverages",
  // "journey" only when used as metaphor — tricky to detect perfectly,
  // but prompt-level instruction is stronger than post-check
  // Pricing apologetics (was previously in fleet-caption only)
  "budget-conscious",
  "surprisingly accessible",
  "affordable luxury",
  "smart investment",
  "smartly priced",
  "value-conscious",
  "price-sensitive",
];

// Allowed emoji whitelist — strict 4. Everything else forbidden.
// Applied to BOTH fleet captions and comment replies (webhook).
export const ALLOWED_EMOJI = ["⛵", "🌊", "⚓", "✨"];

/**
 * Block of voice rules prepended to every AI system prompt. Writes
 * as a single paragraph so it slots into existing prompts cleanly.
 */
export const VOICE_GUARDRAILS = `BRAND VOICE RULES (mandatory — these apply to every AI output for George Yachts):

PRONOUN: 'we' / 'our team'. NEVER 'I'. NEVER claim personal years of experience.

REGISTER: Write in the voice of Condé Nast Traveler or Robb Report. UHNW audience — discerning, skeptical of hype. Avoid tech/startup vocabulary like "primed", "unlocks", "leverages", "platform", or "journey" used as metaphor.

CONCRETE > ABSTRACT. Empty luxury superlatives weaken credibility and are BANNED: "exceptional", "unparalleled", "renowned", "pedigree", "high standards", "incredible", "stunning", "elevated", "iconic", "unforgettable", "primed for discovery". Replace each with a specific concrete moment — instead of "exceptional experience", write "breakfast on deck as the sun rises behind Hydra".

PRICING: Never apologize for the price. Banned phrases: "budget-conscious", "surprisingly accessible", "affordable luxury", "smart investment", "smartly priced", "value-conscious", "price-sensitive". Quote the rate straight, once, in passing. UHNW guests do not need reassurance they can afford the boat.

EMOJI: NO emoji anywhere inside the caption/reply body. At most ONE optional emoji at the very end, chosen only from: ⛵ 🌊 ⚓ ✨. No laughing, no fire, no hearts, no 100, no party. Anything else is a violation.`;

/**
 * Detect banned filler phrases in generated text. Returns lowercased
 * matches for logging. Case-insensitive substring match.
 */
export function detectBannedPhrases(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const low = text.toLowerCase();
  const hits: string[] = [];
  for (const phrase of BANNED_FILLER_PHRASES) {
    if (low.includes(phrase)) hits.push(phrase);
  }
  return hits;
}

/**
 * Detect emoji in body that are NOT in the allow-list, or ANY emoji
 * that is not at the very end. Returns array of offending tokens.
 */
export function detectEmojiViolations(text: string): string[] {
  if (!text) return [];
  // Emoji regex: basic coverage of common emoji unicode blocks.
  const emojiRegex =
    /(\p{Extended_Pictographic}(?:\u200D\p{Extended_Pictographic})*)/gu;
  const matches = Array.from(text.matchAll(emojiRegex));
  if (matches.length === 0) return [];

  const violations: string[] = [];
  // Check last emoji: is it at the end of the string? Is it whitelisted?
  const lastMatch = matches[matches.length - 1];
  const trailingText = text.slice((lastMatch.index ?? 0) + lastMatch[0].length).trim();
  const lastAtEnd = trailingText.length === 0;
  const lastAllowed = ALLOWED_EMOJI.includes(lastMatch[0]);

  // All emoji except possibly the last should be violations.
  for (let i = 0; i < matches.length - 1; i++) {
    violations.push(matches[i][0]);
  }
  // Last emoji: violation unless it's both whitelisted AND at the end.
  if (!lastAtEnd || !lastAllowed) {
    violations.push(lastMatch[0]);
  }
  return violations;
}
