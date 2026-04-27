// Sprint 2.3 — Pillar 4: commitment extractor.
//
// Scans an outbound email body for promises George made and extracts:
//   - the verbatim commitment sentence
//   - a concise summary
//   - the deadline (parsed to a date when possible)
//   - the deadline phrase (raw — useful for the cockpit display)
//
// Returns 0..N commitments per email. A single thank-you reply
// usually has 0; a partner intro email might have 2–3 ("I'll send
// you the package + loop in our captain + come back with dates").
//
// AI-driven for accuracy (the brief calls out 85% accuracy on a
// 30-message sample as the bar). Cheap heuristic pre-filter
// avoids paying the AI on emails with zero commitment-shaped
// language.

import { aiChat } from "@/lib/ai";

export interface ExtractedCommitment {
  commitment_text: string;       // verbatim sentence
  commitment_summary: string;    // 1-line AI summary
  deadline_date: string | null;  // YYYY-MM-DD
  deadline_phrase: string;       // raw phrase from the email
  confidence: number;            // 0..1
}

// Pre-filter: skip the AI call entirely when no commitment-shaped
// language is present. Saves cost on the typical "thanks!" reply.
const COMMITMENT_TRIGGERS_RE =
  /\b(i(?:'ll| will| am going to| 'm going to| shall)|let me|let's|we(?:'ll| will)|happy to|will (send|share|forward|circle\s+back|come\s+back|loop\s+in|follow\s+up|prepare|put\s+together|reach\s+out|book|get\s+back)|by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|end\s+of|the\s+end\s+of|next\s+(week|monday|tuesday|wednesday|thursday|friday)|early\s+next|this\s+(week|afternoon|evening))|tomorrow|in\s+a\s+(few|couple)\s+(days|hours)|asap|first\s+thing|over\s+the\s+weekend|before\s+(end\s+of\s+)?(today|tomorrow|monday|tuesday|wednesday|thursday|friday)|by\s+\d+(:\d+)?\s*(am|pm)?|by\s+(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?))/i;

export function hasCommitmentLanguage(body: string): boolean {
  if (!body) return false;
  // Strip quoted lines first — we only care about NEW content George
  // wrote, not commitments in the quoted thread.
  const cleaned = body
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .split(/^On\b [^\n]{4,120}\bwrote:/im)[0];
  return COMMITMENT_TRIGGERS_RE.test(cleaned);
}

const SYSTEM = `You analyze a SINGLE outbound email written by George (a yacht broker) and extract any PROMISES George made to the recipient.

CRITICAL OUTPUT RULES:
- Output ONLY a raw JSON object. NO markdown fences. NO prose. Start with { end with }.
- Schema: {"commitments":[{"commitment_text":"<verbatim sentence>","commitment_summary":"<≤80 chars>","deadline_date":"<YYYY-MM-DD or null>","deadline_phrase":"<raw phrase>","confidence":<0..1>}]}
- Empty array if no commitments: {"commitments":[]}

What counts as a commitment:
- George says he'll do something specific: "I'll send the package", "I'll loop in our captain", "I'll come back to you with options"
- George commits to a deadline, even soft: "by Monday", "early next week", "tomorrow", "this afternoon"
- Conditional commitments: "happy to set up a call this week" (yes), "let me know if you're interested" (no — that's an open question, not a promise)

What does NOT count:
- Polite courtesy: "Thanks!", "Speak soon", "Talk to you Monday" (Monday is a goodbye, not a commitment)
- Suggestions: "We could discuss…", "It might make sense to…"
- Questions: "Would you like…", "When are you available…"
- Past actions: "I sent you the brochure last week"
- General intent without a specific deliverable: "I'll be in touch"

Deadline parsing rules:
- "Monday" → next Monday's calendar date
- "tomorrow" → tomorrow's date
- "early next week" → next Monday
- "end of week" → next Friday
- "by 4/5" → that exact date in current year
- "asap" / "soon" → null deadline_date but include in deadline_phrase
- Missing → null

Today's date for relative parsing is included in the user message. Be precise about dates.`;

export async function extractCommitmentsAI(
  body: string,
  todayISO: string,
): Promise<ExtractedCommitment[]> {
  const userMsg = JSON.stringify({
    today: todayISO,
    email_body: body.slice(0, 6000),
  });
  let raw: string;
  try {
    raw = await aiChat(SYSTEM, userMsg, { maxTokens: 1500, temperature: 0.1 });
  } catch (err) {
    console.error("[commitment-extractor] AI call failed:", err);
    return [];
  }
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]) as {
      commitments?: Array<Partial<ExtractedCommitment>>;
    };
    return (parsed.commitments ?? [])
      .filter((c) => c.commitment_text && typeof c.commitment_text === "string")
      .map((c) => ({
        commitment_text: c.commitment_text!.slice(0, 400),
        commitment_summary: (c.commitment_summary ?? c.commitment_text!).slice(0, 100),
        deadline_date: c.deadline_date ?? null,
        deadline_phrase: c.deadline_phrase ?? "",
        confidence: Math.max(0, Math.min(1, c.confidence ?? 0.5)),
      }));
  } catch (err) {
    console.error("[commitment-extractor] parse failed:", err);
    return [];
  }
}

/**
 * Extract commitments from one outbound email. Returns [] if no
 * commitment-shaped language is present (skips the AI call).
 */
export async function extractCommitments(
  body: string,
  todayISO: string,
): Promise<ExtractedCommitment[]> {
  if (!hasCommitmentLanguage(body)) return [];
  return extractCommitmentsAI(body, todayISO);
}
