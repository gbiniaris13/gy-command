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
  // Roberto 2026-04-22 additions — cheap-Instagram voice
  "amazing",
  "moment stands out",
  "there's a moment",
  "behind the scenes",
  "vibes",
  "awaits",
  "into perspective",
  "the sea has a way",
  "glamorous spreadsheets",
  // Fabricated client stories = brand risk (UHNW NDA culture)
  "couple from dubai",
  "couple from dallas",
  "family from",
  "i had the pleasure of assisting",
  "last season, i had",
  "last season i had",
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

REGISTER: Write in the voice of Condé Nast Traveler or Robb Report. UHNW audience (net worth $50M+) — discerning, skeptical of hype. Greek hospitality (filotimo) at the core: quiet luxury, restraint, service through presence not performance. Avoid tech/startup vocabulary like "primed", "unlocks", "leverages", "platform", or "journey" used as metaphor.

CONCRETE > ABSTRACT. Empty luxury superlatives weaken credibility and are BANNED: "exceptional", "unparalleled", "renowned", "pedigree", "high standards", "incredible", "stunning", "elevated", "iconic", "unforgettable", "amazing", "primed for discovery", "moment stands out", "there's a moment", "behind the scenes", "vibes", "awaits", "into perspective", "the sea has a way". Replace each with a specific concrete detail — instead of "exceptional experience", write "breakfast on deck as the sun rises behind Hydra".

ONE IDEA PER POST. A caption has exactly one sensory detail + one clear offer (the yacht, the route, the feature). No list of three things. No meta-narration about the broker's life.

CLIENT PRIVACY (MYBA CONFIDENTIALITY): Never fabricate or reference specific past clients. BANNED: "couple from Dubai/Dallas/anywhere", "family from X", "last season I had the pleasure of", "I helped a family", anything that implies a real private charter. UHNW clients' NDAs forbid this. If a general anecdote is needed, use aggregate framing: "agencies we work with tell us…" not "a client told me…".

CTA: Single soft CTA at the end. Use: "Charter inquiries → link in bio", or "Save this for your summer planning", or a MYBA-appropriate invitation. Never "Book now", never "Don't miss out", never "Limited time".

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
