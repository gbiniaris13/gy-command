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
  "Answer with ONE line. Reply exactly UNSAFE: <reason> if the image shows any of the following: " +
  "a building, office, storefront, marina office or reception; any company sign, logo, flag or wordmark other than the yacht's own name on her hull; " +
  "a watermark or overlaid website/company text (for example a charter website's name in a corner); a brochure page, collage, map or document; " +
  "a screenshot; a person at a desk or counter; a car, plane or hotel. " +
  "Otherwise reply exactly SAFE. A yacht, her decks, cabins, food, sea, coast, anchorage, tender, toys or guests at sea are SAFE. " +
  "A small Greek flag on the yacht is SAFE. Text that is clearly the yacht's own name on the hull is SAFE.";

export async function imageBrandIssue(imageUrl: string): Promise<string | null> {
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
      max_tokens: 60,
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
    if (/^UNSAFE/i.test(out)) return out.replace(/^UNSAFE:?\s*/i, "").slice(0, 200) || "flagged by vision check";
    if (/^SAFE/i.test(out)) return null;
    // Unexpected answer: treat as unsafe, a human can approve by re-scheduling.
    return `unclear vision verdict: ${out.slice(0, 120)}`;
  } catch (e) {
    console.error("[brand-safety] vision check failed, not blocking:", (e as Error)?.message);
    return null;
  }
}
