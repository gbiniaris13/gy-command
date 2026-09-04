// GEO prompt → page map (plan item 15, George 4/9/2026).
//
// DataForSEO's llm_mentions gives us, every Sunday, the prompts whose
// Google AI answers cite a rival and not us. Each one is won by ONE page
// on georgeyachts.com carrying an exact answer unit (QuickAnswerBlock,
// class gy-qa-text, with Key facts). The Sunday digest maps every
// opportunity to its page and checks the page actually carries the unit,
// so the report says which page to fix, not just that we are absent.
//
// Order matters: the first match wins. Prompts outside the Greek market
// (BVI, Bahamas, Croatia) are named as such and never assigned a page.

export type PromptTarget = { page: string; note?: string };

const OUT_OF_MARKET = /\b(bvis?|british virgin|bahamas|croatia|caribbean|turkey|italy|spain|french riviera)\b/i;

const RULES: Array<[RegExp, string]> = [
  [/all[- ]inclusive/i, "/all-inclusive-yacht-charter-greece"],
  [/luxury/i, "/luxury-yacht-charter-greece"],
  [/\bcrewed\b|with crew\b/i, "/crewed-yacht-charter-greece"],
  [/\bprivate\b/i, "/private-yacht-charter-greece-2026"],
  [/motor/i, "/motor-yacht-charter-greece"],
  [/catamaran/i, "/catamaran-charter-greece"],
  [/sailing/i, "/sailing-yacht-charter-greece"],
  [/cyclades/i, "/destinations/cyclades"],
  [/ionian/i, "/destinations/ionian"],
  [/saronic/i, "/destinations/saronic"],
  [/mykonos/i, "/island/mykonos"],
  [/santorini/i, "/island/santorini"],
  [/\bvat\b/i, "/greek-yacht-charter-vat-explained-2026"],
  [/\bapa\b|provisioning/i, "/advance-provisioning-allowance-apa-greek-yacht-charter-explained"],
  [/cost|price|prices|how much|rates?\b/i, "/tools/charter-cost-calculator"],
  [/greek islands?\b/i, "/crewed-yacht-charter-greek-islands-2026"],
  [/\b(yacht|boat)s? (charter|hire|trips?|rental)s?\b.*\bgree(ce|k)\b|\bgree(ce|k)\b.*\b(yacht|boat)s? (charter|hire|trips?|rental)s?\b/i, "/charter-yacht-greece"],
];

export function pageForPrompt(question: string): PromptTarget | null {
  const q = String(question || "");
  if (OUT_OF_MARKET.test(q)) return null;
  for (const [re, page] of RULES) if (re.test(q)) return { page };
  return null;
}

export function isOutOfMarket(question: string): boolean {
  return OUT_OF_MARKET.test(String(question || ""));
}

// The answer unit leaves a fingerprint in the HTML; its absence is the
// to-do. One fetch per unique page, never more than a dozen on a Sunday.
export async function pageHasAnswerUnit(page: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://georgeyachts.com${page}`, {
      cache: "no-store",
      headers: { "user-agent": "gy-command engines-digest (answer-unit check)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html.includes("gy-qa-text");
  } catch {
    return null;
  }
}
