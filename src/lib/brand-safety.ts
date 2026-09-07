// Brand safety for everything the house publishes on its own channels.
//
// George, 2026-09-07 (SOS): a story carried a partner's office sign, lifted
// from a yacht's photo set, and captions had named the houses we place with.
// Rule, verbatim: "δεν γίνεται να διαφημίζουμε με ποιους συνεργαζόμαστε ...
// ούτε Ιστίον, ούτε FX, ούτε FYLY, ούτε IYC, ούτε τίποτα". Nothing another
// company owns (name, logo, sign, office, watermark) goes out under
// @georgeyachts.
//
// Two checks, both fail-CLOSED for the thing being published:
//   containsPartnerName(text)  -> string | null   (which name tripped it)
//   imageBrandIssue(imageUrl)  -> string | null   (why the image is unsafe)
// The image check asks the same Gemini model the captions use, with the
// image attached, a yes/no question about other companies' branding,
// buildings, signage, watermarks or text. If the model call itself fails we
// return null (do not block on our own outage) but log it, because a missed
// check is recoverable and a blocked feed is a silent outage.

import OpenAI from "openai";

const PARTNER_NAMES: Array<[string, RegExp]> = [
  ["Istion", /istion/i],
  ["FX Yachting", /\bfx\s*yacht/i],
  ["FYLY", /\bfyly\b/i],
  ["IYC", /\biyc\b/i],
  ["Fraser", /\bfraser\b/i],
  ["Burgess", /\bburgess\b/i],
  ["Northrop & Johnson", /northrop/i],
  ["Edmiston", /\bedmiston\b/i],
  ["mygreekcharter", /mygreekcharter/i],
  ["ionian-charter", /ionian-charter/i],
  ["12knots", /12knots/i],
  ["TheThoms", /thethoms/i],
  ["Valef", /\bvalef\b/i],
  ["central agent by name", /central agen(t|cy)\s+[A-Z][a-z]+/],
];

// Replaces any partner or competitor name in generated copy with a neutral
// phrase. Used where a caption is produced by the model and must still ship
// on time (reels, article captions); the feed guard blocks instead.
export function scrubPartnerNames(text: string): string {
  let out = text;
  for (const [, re] of PARTNER_NAMES) {
    out = out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), "the owner");
  }
  return out;
}

export function containsPartnerName(text: string | null | undefined): string | null {
  const t = (text ?? "").toString();
  if (!t) return null;
  for (const [label, re] of PARTNER_NAMES) if (re.test(t)) return label;
  return null;
}

const VISION_PROMPT =
  "You are checking a photograph before it is posted on a yacht charter brokerage's Instagram. " +
  "The house never shows another company. Answer with ONE line. " +
  "Reply UNSAFE: <quote the exact text or name you see> if the image contains any of the following: " +
  "an office, shop front, reception desk or a company sign as the subject of the photo; " +
  "a company name, website address or logo overlaid on the photo (a watermark, a caption bar, a corner credit, a brochure header or footer); " +
  "a brochure page with marketing text, a collage with text, a screenshot, a map with a company name; a person at a desk or counter. " +
  "Otherwise reply exactly SAFE. " +
  "SAFE: a yacht, her decks, cabins, food, sea, coast, anchorage, tender, toys, guests; towns, houses, marinas or buildings in the background or on the shore; " +
  "a layout or deck-plan drawing without company text; the yacht's own name on the hull, pillows or towels; the boat builder's badge on the boat; " +
  "equipment brands (engines, electronics, appliances, televisions); a Greek flag.";

export async function imageBrandIssue(imageUrl: string, yachtName?: string | null): Promise<string | null> {
  if (!imageUrl) return "no image url";
  if (!process.env.AI_API_KEY) return null;
  try {
    const ai = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: process.env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
    });
    const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || "gemini-2.5-flash";
    const res = await ai.chat.completions.create({
      model,
      temperature: 0,
      // Gemini 2.5 spends "thinking" tokens out of max_tokens; a 60-token cap
      // truncated the verdict to "UN" and every post would have read as
      // unclear. Generous cap, thinking off, one-line answer.
      max_tokens: 1000,
      // @ts-expect-error Gemini-only extension accepted by the OpenAI-compatible endpoint
      extra_body: { google: { thinking_config: { thinking_budget: 0, include_thoughts: false } } },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: VISION_PROMPT },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    });
    const out = (res.choices[0]?.message?.content || "").trim();
    if (/^SAFE/i.test(out)) return null;
    if (!/^UNSAFE/i.test(out)) {
      // Unexpected answer: treat as unsafe, a human can approve by re-scheduling.
      return `unclear vision verdict: ${out.slice(0, 120)}`;
    }
    // The model quotes whatever text it read. Most of it is the yacht's own
    // name, her builder or an equipment brand (measured on 1,458 fleet
    // images: 290 quotes, 12 real). A known partner name or a hard reason
    // (office, screenshot, watermark, brochure) blocks outright; anything
    // else is asked about once more, as text, before it blocks.
    const quoted = out.replace(/^UNSAFE:?\s*/i, "").trim().slice(0, 200) || "flagged by vision check";
    const partner = containsPartnerName(quoted);
    if (partner) return `${quoted} (${partner})`;
    if (/office|reception|screenshot|watermark|brochure|website|http|www\.|\.com\b|\.gr\b|caption bar|corner credit|company sign|desk|counter|collage/i.test(quoted)) return quoted;
    if (yachtName && quoted.toLowerCase().includes(yachtName.toLowerCase())) return null;
    const second = await ai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 200,
      // @ts-expect-error Gemini-only extension accepted by the OpenAI-compatible endpoint
      extra_body: { google: { thinking_config: { thinking_budget: 0, include_thoughts: false } } },
      messages: [
        {
          role: "user",
          content:
            `The text "${quoted}" was read off a photograph of a charter yacht in Greece` +
            (yachtName ? ` named ${yachtName}` : "") +
            ". Is it the name, brand or website of a yacht charter company, yacht broker, charter agency, marina, travel business or media outlet? " +
            "The yacht's own name, boat builders and models (Lagoon, Fountaine Pajot, Bali, Sunreef, Princess, Azimut, Admiral, Aicon, Riva, Conrad, Excess), " +
            "equipment and consumer brands (Garmin, Raymarine, Furuno, Simrad, Yamaha, Suzuki, Jobe, Sea-Doo, Williams, Highfield, Aqua Marina, Smeg, Grohe, Siemens, Coca-Cola, Netflix, Moët, Dior, Ferragamo, Perrier), " +
            "layout labels and generic words are NO. Answer YES or NO and four words why.",
        },
      ],
    });
    const verdict = (second.choices[0]?.message?.content || "").trim();
    if (/^NO/i.test(verdict)) return null;
    return `${quoted} (${verdict.slice(0, 80) || "no second verdict"})`;
  } catch (e) {
    console.error("[brand-safety] vision check failed, not blocking:", (e as Error)?.message);
    return null;
  }
}
