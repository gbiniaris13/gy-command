// The Helm — reusable text blocks for the proposal email, in George's voice:
// formal, warm, restrained, understated. A broker addressing a discerning peer.
//
// CRITICAL: these defaults contain ZERO invented facts. No years in business,
// no client counts, no awards, no superlatives-as-fact, no fabricated
// percentages or credentials. Only generic, true-by-construction phrasing.
// Where a value is needed, an obvious [bracket] placeholder is used so George
// fills it himself — never a made-up figure. Keep it this way.

export type SnippetCategory = "intro" | "terms" | "about" | "closing";

export type Snippet = {
  id: string;
  label: string;
  category: SnippetCategory;
  body: string;
};

export const SNIPPET_CATEGORIES: { key: SnippetCategory; label: string }[] = [
  { key: "intro", label: "Intro" },
  { key: "terms", label: "Terms" },
  { key: "about", label: "About us" },
  { key: "closing", label: "Closing" },
];

export const DEFAULT_SNIPPETS: Snippet[] = [
  {
    id: "intro-curated",
    label: "Warm opening",
    category: "intro",
    body:
      "Thank you for your interest. It was a pleasure to consider your plans for the season. Please find attached a proposal I have prepared with your preferences in mind, with a small selection of yachts I felt would suit you well.",
  },
  {
    id: "terms-availability",
    label: "Rates and availability",
    category: "terms",
    body:
      "Rates are quoted subject to availability and final confirmation. APA, VAT and any extras are as detailed in the attached proposal. I would be glad to hold a particular yacht for you while you consider the options.",
  },
  {
    id: "about-curation",
    label: "Personal brokerage",
    category: "about",
    body:
      "Ours is a personal and discreet brokerage. We work closely with a curated fleet in Greek waters and arrange each charter around the guests aboard, attending to the detail so that you need not.",
  },
  {
    id: "closing-questions",
    label: "Warm close",
    category: "closing",
    body:
      "I am at your disposal for any question, and happy to refine the selection should you wish. I look forward to hearing your thoughts.",
  },
];
