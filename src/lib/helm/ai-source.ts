// Which AI assistant sent the client, when we can tell (2026-10-08, plan
// item 13: "note in the CRM every request that mentions ChatGPT").
//
// Two signals, first-party only: the message the client wrote ("found you
// on ChatGPT") and the referrer the site captured when they arrived
// (chatgpt.com, perplexity.ai, copilot, gemini, claude.ai). The result lands
// at extraction.ai_source, is written into the brief as one plain line, and
// is shown on the request page. Never shown to the client.

export type AiSource = {
  assistant: string;
  where: "message" | "referrer";
  detected_at: string;
};

const MENTIONS: [RegExp, string][] = [
  [/chat\s?-?gpt|openai|open\s?ai\b/i, "ChatGPT"],
  [/perplexity/i, "Perplexity"],
  [/\bcopilot\b/i, "Copilot"],
  [/\bgemini\b|\bbard\b/i, "Gemini"],
  [/\bclaude\b|anthropic/i, "Claude"],
  [/\bgrok\b/i, "Grok"],
];

const REFERRERS: [RegExp, string][] = [
  [/(^|\.)chatgpt\.com|chat\.openai\.com|(^|\.)openai\.com/i, "ChatGPT"],
  [/perplexity\.ai/i, "Perplexity"],
  [/copilot\.microsoft\.com|bing\.com\/chat|copilot\.com/i, "Copilot"],
  [/gemini\.google\.com|bard\.google\.com/i, "Gemini"],
  [/claude\.ai/i, "Claude"],
  [/grok\.com|x\.ai/i, "Grok"],
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function detectAiSource(input: {
  message?: string | null;
  brief?: string | null;
  arrivedFrom?: string | null;
}): AiSource | null {
  const now = new Date().toISOString();
  const text = [input.message || "", input.brief || ""].join("\n");
  for (const [re, assistant] of MENTIONS) {
    if (re.test(text)) return { assistant, where: "message", detected_at: now };
  }
  const ref = (input.arrivedFrom || "").trim();
  if (ref) {
    const host = hostOf(ref);
    for (const [re, assistant] of REFERRERS) {
      if (re.test(host) || re.test(ref)) return { assistant, where: "referrer", detected_at: now };
    }
  }
  return null;
}

/** One plain line for the brief and the Telegram ping. */
export function aiSourceLine(src: AiSource): string {
  return src.where === "referrer"
    ? `Found us through ${src.assistant} (arrived from it).`
    : `Found us through ${src.assistant} (said so in the message).`;
}

export function readAiSource(extraction: unknown): AiSource | null {
  const ex = extraction && typeof extraction === "object" ? (extraction as { ai_source?: unknown }) : null;
  const a = ex?.ai_source;
  if (!a || typeof a !== "object") return null;
  const o = a as Partial<AiSource>;
  if (typeof o.assistant !== "string" || !o.assistant) return null;
  return { assistant: o.assistant, where: o.where === "referrer" ? "referrer" : "message", detected_at: typeof o.detected_at === "string" ? o.detected_at : "" };
}
