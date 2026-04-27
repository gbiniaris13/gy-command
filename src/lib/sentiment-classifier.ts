// Sprint 2.4 — Pillar 5: per-message sentiment classifier.
//
// Classifies an inbound message on three dimensions used by the
// health-score formula:
//   - warmth      : cold | neutral | warm | very_warm
//   - engagement  : one_line | substantive | detailed | with_questions
//   - intent      : parked | static | advancing | closing
//
// Cached on activities.sentiment_* so the nightly score recompute
// doesn't pay the AI again. Only inbound messages need scoring
// (we score the contact's tone, not George's).

import { aiChat } from "@/lib/ai";

export type Warmth = "cold" | "neutral" | "warm" | "very_warm";
export type Engagement =
  | "one_line"
  | "substantive"
  | "detailed"
  | "with_questions";
export type Intent = "parked" | "static" | "advancing" | "closing";

export interface SentimentResult {
  warmth: Warmth;
  engagement: Engagement;
  intent: Intent;
}

const SYSTEM = `You score a single inbound email from a contact to George (a yacht broker).

CRITICAL OUTPUT RULES:
- Output ONLY raw JSON. NO markdown fences. NO prose. Start with { end with }.
- Schema: {"warmth":"<W>","engagement":"<E>","intent":"<I>"}
- W ∈ cold | neutral | warm | very_warm
- E ∈ one_line | substantive | detailed | with_questions
- I ∈ parked | static | advancing | closing

Definitions:
- warmth (the contact's tone toward George):
  cold        formal/transactional, no warmth markers
  neutral     polite-professional, no extra warmth
  warm        friendly, "happy to", "great", "looking forward"
  very_warm   personal, "George I really appreciated", uses his first name with feeling, references shared moments
- engagement (effort the contact put in):
  one_line       <20 words, "got it" / "thanks" / "ok"
  substantive    1-2 paragraphs, addresses the topic
  detailed       3+ paragraphs OR with structured info (dates, numbers, ids)
  with_questions ASKS questions back — highest engagement, shows real interest
- intent (where this conversation is going):
  parked      "I'll be in touch when…", "after the holidays" — relationship on hold
  static      polite back-and-forth with no forward motion
  advancing   moving toward a deal / meeting / next concrete step
  closing     ending the relationship politely OR explicit no`;

export async function classifySentiment(
  body: string,
): Promise<SentimentResult | null> {
  if (!body || body.length < 5) return null;
  const userMsg = JSON.stringify({ body: body.slice(0, 3000) });
  let raw: string;
  try {
    raw = await aiChat(SYSTEM, userMsg, { maxTokens: 200, temperature: 0.1 });
  } catch (err) {
    console.error("[sentiment-classifier] ai failed:", err);
    return null;
  }
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]) as Partial<SentimentResult>;
    const warmthOk: Warmth[] = ["cold", "neutral", "warm", "very_warm"];
    const engOk: Engagement[] = [
      "one_line",
      "substantive",
      "detailed",
      "with_questions",
    ];
    const intOk: Intent[] = ["parked", "static", "advancing", "closing"];
    if (
      !p.warmth ||
      !p.engagement ||
      !p.intent ||
      !warmthOk.includes(p.warmth) ||
      !engOk.includes(p.engagement) ||
      !intOk.includes(p.intent)
    )
      return null;
    return p as SentimentResult;
  } catch {
    return null;
  }
}

// Numeric weights used by the health-score formula.
export const WARMTH_SCORE: Record<Warmth, number> = {
  cold: -8,
  neutral: 0,
  warm: 6,
  very_warm: 12,
};
export const ENGAGEMENT_SCORE: Record<Engagement, number> = {
  one_line: -3,
  substantive: 2,
  detailed: 5,
  with_questions: 10,
};
export const INTENT_SCORE: Record<Intent, number> = {
  parked: -10,
  static: -2,
  advancing: 12,
  closing: -25,
};
