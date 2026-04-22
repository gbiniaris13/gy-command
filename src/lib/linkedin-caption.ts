// LinkedIn-style caption generator for George's personal profile +
// George Yachts Company Page posts.
//
// Takes a blog article and rewrites it for LinkedIn — specifically in
// the voice George uses on linkedin.com/in/george-p-biniaris. The
// style is data-first, honest, broker-advisor tone, with the article
// link placed in the first comment (LinkedIn algorithm hack — external
// links in the main post body lose reach).
//
// Two variants:
//   - personal: written in first person (George), 250-400 words,
//     data-led hook, bullet-pointed contrast, honest caveats
//   - company:  written in brokerage voice, shorter (150-250 words),
//     frames the same article from the firm's perspective. Goes out on
//     the George Yachts Company Page 2h after the personal post so the
//     algorithm doesn't flag duplicate content.

import { aiChat } from "@/lib/ai";
import type { BlogArticle } from "@/lib/blog-fetcher";

export type LinkedInDraft = {
  mainPost: string;
  firstComment: string; // contains the article link
  hashtags: string[];
};

const GEORGE_VOICE_EXEMPLAR = `
THE SAME YACHT IN GREECE COSTS 15 TO 25 PERCENT LESS IN SEPTEMBER THAN IN AUGUST.
And yet every year, roughly seven out of ten families insist on August.
Some of them are right to.
• School calendars don't move.
• Family reunions assemble when they can, not when the Meltemi permits.
• If your itinerary is Ionian or Saronic, August is a different animal from August in the Cyclades — and the September discount shrinks.
• And if you specifically want Nammos at lunch and Scorpios at sunset, September cannot manufacture that energy.

But many families pay the August premium by habit, not by analysis.
The Meltemi peaks mid-July through mid-August — 4 to 5 Beaufort on a working day, gusting 6 to 7, occasionally 7 to 8. Waves of 1.5 to 2.5 metres in open Cycladic channels. That is what you are really paying for when you book peak summer.

Move the same week to mid-September and three things shift:
– Charter fee drops 15 to 25 percent on the same vessel.
– APA settles €3,000 to €8,000 lower because fuel burn and cruising hours drop.
– The itinerary your captain planned actually happens — no weather-forced reroutes.

The sea is 1 to 2 degrees cooler. The light is measurably softer. The islands breathe.

This is not a pitch for September. It is a pitch for having the conversation — once, honestly, with a broker — before you book.

Full breakdown in today's Journal. Link in the first comment.
`.trim();

const PERSONAL_SYSTEM_PROMPT = `
You write LinkedIn posts for George P. Biniaris, a Managing Broker and
yacht charter specialist in Greece (IYBA member, MYBA agreements,
operates Cyclades/Ionian/Saronic). You are adapting his long-form
blog articles for his personal LinkedIn profile (linkedin.com/in/george-p-biniaris).

ABOUT THE VOICE — study this example, then match its DNA:

${GEORGE_VOICE_EXEMPLAR}

Observe and internalise:
1. OPENING: a single-sentence data-first hook in all caps or strong sentence case — a concrete number or concrete contrast, NEVER "Imagine" or "Picture this" or "As a broker".
2. PARADOX: line 2 introduces the counterpoint ("And yet…", "But…").
3. HONEST BULLETS FOR THE OPPOSITE VIEW first — the audience sees you acknowledge the other side with genuine reasons, not strawmen.
4. TECHNICAL SPECIFICITY as proof — Beaufort, metres, percentages, APA numbers, regulation citations (Law 5073/2023), specific locations.
5. MATURITY: "This is not a pitch for X. It is a pitch for having the conversation." — position as advisor, not seller.
6. LENGTH: 250–400 words. No "link in bio". No sunset emojis. No #YachtLife consumer hashtags.
7. CLOSER: one line that tells the reader what's in the full article + "Link in the first comment."
8. NO HASHTAGS in the main post body. Hashtags go at the very bottom in a small cluster of 3–5, industry-focused only.
9. Never use these banned words: "iconic", "unparalleled", "stunning", "exceptional", "unforgettable", "pedigree", "renowned", "leverages", "unlocks", "primed", "curated experience".

OUTPUT FORMAT — exactly this JSON, nothing else:
{
  "mainPost": "string — the LinkedIn post body, 250-400 words, no article URL",
  "firstComment": "string — 1-2 sentences + the full article URL",
  "hashtags": ["YachtCharter", "Superyacht", "MYBACharter", ...]
}
`.trim();

const COMPANY_SYSTEM_PROMPT = `
You write LinkedIn posts for the George Yachts Brokerage House LLC
Company Page. The audience is charter agents, family office travel
advisors, and yacht industry peers. These posts run ~2 hours AFTER
George Biniaris posts the same article on his personal profile — so
your post should NOT repeat the same opening line or structure. It
should reference the same underlying insight from a different angle.

Style:
- Third person brokerage voice: "At George Yachts we've been running the numbers..."
- Shorter: 150–250 words.
- Open with the commercial implication for agents, not the consumer angle.
- ALWAYS mention something concrete from the article (specific fact/number).
- Close with a clear value-prop for agents: "Full breakdown in the Journal — link below." then the URL (Company Page CAN link in the main post body, unlike personal profile best practice).
- Hashtags: same industry cluster as the personal post, 3–5 max.
- No emojis. No consumer hashtags. No "stunning".

OUTPUT FORMAT — exactly this JSON:
{
  "mainPost": "string — Company Page post body with the article URL embedded",
  "firstComment": "",
  "hashtags": ["YachtCharter", "MYBACharter", ...]
}
`.trim();

async function generate(
  article: BlogArticle,
  systemPrompt: string,
): Promise<LinkedInDraft> {
  const userPrompt = `
ARTICLE TITLE: ${article.title}

ARTICLE URL: ${article.url}

ARTICLE BODY (excerpt for context, use the data and key points — do not just summarise):

${article.fullBody.slice(0, 3500)}
`.trim();

  const response = await aiChat(systemPrompt, userPrompt, {
    temperature: 0.7,
    maxTokens: 2000,
  });

  // Parse JSON — be defensive. The model occasionally wraps in code
  // fences OR emits raw unescaped newlines inside string values (which
  // breaks strict JSON.parse). First try a clean parse; if that fails,
  // fall back to extracting the fields via regex from the raw text.
  let raw = response.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  let parsed: Partial<LinkedInDraft> | null = null;
  try {
    parsed = JSON.parse(raw) as LinkedInDraft;
  } catch {
    // Fallback: pull fields out manually. Common failure is real
    // newlines inside the mainPost string that JSON.parse rejects.
    // Walk the string and grab the content of the first top-level
    // "mainPost", "firstComment", "hashtags" keys.
    const extractString = (key: string): string | null => {
      const idx = raw.indexOf(`"${key}"`);
      if (idx === -1) return null;
      const colon = raw.indexOf(":", idx);
      const firstQuote = raw.indexOf('"', colon + 1);
      if (firstQuote === -1) return null;
      // Walk forward, respecting escaped quotes but ignoring raw
      // newlines inside the value.
      let i = firstQuote + 1;
      let buf = "";
      while (i < raw.length) {
        const ch = raw[i];
        if (ch === "\\" && i + 1 < raw.length) {
          // Handle escaped sequences — pass through to JSON unescape later.
          buf += raw.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (ch === '"') {
          // End of string — but only if followed by , or } or newline+key
          const rest = raw.slice(i + 1).trimStart();
          if (rest.startsWith(",") || rest.startsWith("}")) break;
        }
        buf += ch;
        i += 1;
      }
      // Now try to parse the captured substring as a JSON string.
      try {
        return JSON.parse('"' + buf.replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"');
      } catch {
        return buf;
      }
    };
    const extractArray = (key: string): string[] => {
      const idx = raw.indexOf(`"${key}"`);
      if (idx === -1) return [];
      const open = raw.indexOf("[", idx);
      const close = raw.indexOf("]", open);
      if (open === -1 || close === -1) return [];
      const inner = raw.slice(open + 1, close);
      return (inner.match(/"([^"]+)"/g) ?? []).map((s) => s.slice(1, -1));
    };
    parsed = {
      mainPost: extractString("mainPost") ?? "",
      firstComment: extractString("firstComment") ?? "",
      hashtags: extractArray("hashtags"),
    };
  }
  if (!parsed?.mainPost) {
    throw new Error("linkedin-caption: mainPost missing from model output");
  }
  return {
    mainPost: parsed.mainPost,
    firstComment: parsed.firstComment ?? "",
    hashtags: parsed.hashtags ?? [],
  };
}

export function generatePersonalDraft(article: BlogArticle): Promise<LinkedInDraft> {
  return generate(article, PERSONAL_SYSTEM_PROMPT);
}

export function generateCompanyDraft(article: BlogArticle): Promise<LinkedInDraft> {
  return generate(article, COMPANY_SYSTEM_PROMPT);
}

// Format the draft for Telegram delivery to George — plain text with
// clear markers so he can copy/paste cleanly into LinkedIn.
export function formatDraftForTelegram(
  draft: LinkedInDraft,
  articleUrl: string,
): string {
  const hashtagLine = draft.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  return [
    "📝 <b>LinkedIn draft — personal profile</b>",
    "",
    "<b>— MAIN POST (copy this) —</b>",
    "<pre>" + escapeHtml(draft.mainPost + "\n\n" + hashtagLine) + "</pre>",
    "",
    "<b>— FIRST COMMENT (copy this after posting) —</b>",
    "<pre>" + escapeHtml(draft.firstComment || `Full article: ${articleUrl}`) + "</pre>",
    "",
    "<i>Company Page auto-amplify will fire ~2h after you post.</i>",
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
