// Story link classifier — every Instagram story now resolves to a
// destination URL on georgeyachts.com so the audience always has a
// next-click target. George's directive 2026-05-14: "no story without
// a link from our site".
//
// The classifier reads three signals (in priority order):
//   1. Photo tags        — strict matches first (ig_photos.tags[])
//   2. Photo description — fuzzy keyword scan (ig_photos.description)
//   3. Photo filename    — last-resort hint
//
// If nothing matches confidently, the homepage is the safe fallback.
// Every URL is decorated with UTM so traffic from IG stories is
// attributable in the new visitor-intelligence dashboard.

const SITE = "https://georgeyachts.com";

export interface StoryLinkResult {
  url: string;
  label: string; // human-friendly Telegram-card label
  matched: string; // why this URL was chosen (for debugging + Telegram)
  category: StoryCategory;
}

export type StoryCategory =
  | "specific_yacht"
  | "destination_region"
  | "specific_island"
  | "anchorage"
  | "blog_article"
  | "service_landing"
  | "homepage_fallback";

// ── 1. Specific yachts (highest priority — exact slug match) ──
//
// These are the yachts currently in the Sanity fleet. Tags or
// description that mentions one of these by name links directly to
// the yacht detail page. Update this list when the fleet changes.
const YACHT_SLUGS = [
  "genny",
  "majesty-of-greece",
  "alena",
  "worlds-end",
  "brooklyn",
  "serenissima",
  "my-star",
  "ad-astra",
  "helidoni",
  "serenissima-iii",
  "la-pellegrina",
];

// ── 2. Destinations (regional pages) ──
const REGION_MAP: Array<{ keywords: string[]; slug: string; label: string }> = [
  {
    keywords: ["cyclades", "mykonos", "santorini", "paros", "naxos", "milos", "ios", "amorgos", "antiparos", "sifnos", "serifos", "folegandros", "kythnos", "syros", "andros"],
    slug: "cyclades",
    label: "Cyclades",
  },
  {
    keywords: ["ionian", "corfu", "paxos", "kefalonia", "ithaca", "ithaka", "zakynthos", "zante", "lefkada", "kefalonia"],
    slug: "ionian",
    label: "Ionian",
  },
  {
    keywords: ["saronic", "hydra", "spetses", "poros", "aegina", "agistri"],
    slug: "saronic",
    label: "Saronic",
  },
];

// ── 3. Per-island programmatic pages (more specific than region) ──
const ISLAND_PAGES: Record<string, string> = {
  mykonos: "/yacht-charter-mykonos-anchorages",
  santorini: "/yacht-charter-santorini-anchorages",
  hydra: "/yacht-charter-hydra-anchorages",
  corfu: "/yacht-charter-corfu-anchorages",
  paros: "/yacht-charter-paros-anchorages",
  andros: "/yacht-charter-andros",
  naxos: "/yacht-charter-naxos",
  sifnos: "/yacht-charter-sifnos",
  ithaca: "/yacht-charter-ithaca",
  ithaka: "/yacht-charter-ithaca",
  zakynthos: "/yacht-charter-zakynthos",
  zante: "/yacht-charter-zakynthos",
  rhodes: "/yacht-charter-rhodes",
  symi: "/yacht-charter-symi",
  crete: "/yacht-charter-crete-chania",
  chania: "/yacht-charter-crete-chania",
  skiathos: "/yacht-charter-sporades-skiathos",
  sporades: "/yacht-charter-sporades-skiathos",
  dodecanese: "/yacht-charter-dodecanese-rhodes",
};

// ── 4. Service-landing keywords ──
const SERVICE_MAP: Array<{ keywords: string[]; path: string; label: string }> = [
  { keywords: ["catamaran", "cat-charter"], path: "/best-catamarans-greece-charter", label: "Best catamarans" },
  { keywords: ["gulet", "wooden-yacht", "classic-yacht"], path: "/best-gulets-greece-authentic-experience", label: "Best gulets" },
  { keywords: ["motor-yacht", "speedboat"], path: "/best-motor-yachts-greece-speed", label: "Best motor yachts" },
  { keywords: ["sailing-yacht", "sailboat"], path: "/best-sailing-yachts-greece", label: "Best sailing yachts" },
  { keywords: ["superyacht", "super-yacht"], path: "/best-superyachts-greece-august", label: "Best superyachts" },
  { keywords: ["honeymoon", "couple-yacht", "romantic"], path: "/yacht-charter-greece-honeymoon", label: "Honeymoon charter" },
  { keywords: ["proposal"], path: "/proposal-yacht-charter-greece", label: "Proposal charter" },
  { keywords: ["bachelorette", "hen-party"], path: "/bachelorette-yacht-charter-greece", label: "Bachelorette charter" },
  { keywords: ["bachelor", "stag-party"], path: "/bachelor-party-yacht-charter-greece", label: "Bachelor party charter" },
  { keywords: ["family", "kids", "children"], path: "/yacht-charter-greece-family-with-children", label: "Family charter" },
  { keywords: ["corporate", "team-building"], path: "/yacht-charter-greece-corporate-groups", label: "Corporate charter" },
  { keywords: ["billionaire", "ultra-luxury"], path: "/billionaire-yacht-charter-greece", label: "Billionaire charter" },
  { keywords: ["celebrity"], path: "/celebrity-yacht-charter-greece", label: "Celebrity charter" },
  { keywords: ["milestone", "birthday", "anniversary"], path: "/milestone-celebration-yacht-charter-greece", label: "Milestone celebration" },
  { keywords: ["retreat", "wellness"], path: "/retreat-yacht-charter-greece", label: "Private retreat" },
  { keywords: ["last-minute", "lastminute"], path: "/last-minute-yacht-charter-greece-2026", label: "Last-minute charter" },
  { keywords: ["jet", "helicopter", "aviation"], path: "/private-jet-charter", label: "Private aviation" },
  { keywords: ["villa", "estate"], path: "/luxury-villas-greece", label: "Luxury villas" },
  { keywords: ["transfer", "chauffeur"], path: "/vip-transfers-greece", label: "VIP transfers" },
];

// ── 5. UTM decoration so the Visitor Intelligence dashboard can show
//    "X visitors today came from IG stories campaign Y". ──
function withUtm(path: string, category: StoryCategory): string {
  const base = path.startsWith("http") ? path : `${SITE}${path}`;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}utm_source=instagram&utm_medium=story&utm_campaign=${category}`;
}

// Normalise an arbitrary string for keyword matching.
function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(input: string): string[] {
  return normalise(input).split(/\s+/).filter(Boolean);
}

// Main entry — pass an ig_photos row, get back a StoryLinkResult.
export function classifyPhotoForStory(photo: {
  tags?: string[] | null;
  description?: string | null;
  filename?: string | null;
}): StoryLinkResult {
  const tagSet = new Set(
    (photo.tags ?? []).map((t) => normalise(t)).filter(Boolean),
  );
  const descTokens = new Set(tokens(photo.description ?? ""));
  const fileTokens = new Set(tokens(photo.filename ?? ""));

  const allTokens = new Set<string>();
  for (const t of tagSet) allTokens.add(t);
  for (const t of descTokens) allTokens.add(t);
  for (const t of fileTokens) allTokens.add(t);

  // ── 1. Specific yacht? Highest signal. ──
  for (const slug of YACHT_SLUGS) {
    const slugTokens = slug.split("-");
    const hit =
      tagSet.has(slug) ||
      tagSet.has(slug.replace(/-/g, "")) ||
      // Description / filename: require ALL slug-tokens to appear (so
      // "alena" doesn't false-match a generic "alone" word, etc).
      slugTokens.every((t) => descTokens.has(t)) ||
      slugTokens.every((t) => fileTokens.has(t));
    if (hit) {
      return {
        url: withUtm(`/yachts/${slug}`, "specific_yacht"),
        label: `Yacht detail — ${slug}`,
        matched: `slug:${slug}`,
        category: "specific_yacht",
      };
    }
  }

  // ── 2. Specific island (more specific than region) ──
  for (const [island, path] of Object.entries(ISLAND_PAGES)) {
    if (allTokens.has(island)) {
      return {
        url: withUtm(path, "specific_island"),
        label: `Island guide — ${island}`,
        matched: `island:${island}`,
        category: "specific_island",
      };
    }
  }

  // ── 3. Destination region ──
  for (const region of REGION_MAP) {
    for (const kw of region.keywords) {
      if (allTokens.has(kw)) {
        return {
          url: withUtm(`/destinations/${region.slug}`, "destination_region"),
          label: `Destination — ${region.label}`,
          matched: `region:${region.slug}/${kw}`,
          category: "destination_region",
        };
      }
    }
  }

  // ── 4. Service-landing keyword? ──
  for (const svc of SERVICE_MAP) {
    for (const kw of svc.keywords) {
      // Multi-word keywords are joined with hyphens in the SERVICE_MAP.
      const parts = kw.split("-");
      const hit =
        tagSet.has(kw) ||
        (parts.length > 1 && parts.every((p) => allTokens.has(p))) ||
        allTokens.has(kw);
      if (hit) {
        return {
          url: withUtm(svc.path, "service_landing"),
          label: svc.label,
          matched: `service:${kw}`,
          category: "service_landing",
        };
      }
    }
  }

  // ── 5. Anchorage / beach generic — link to greece-by-yacht ──
  for (const t of ["anchorage", "beach", "coast", "harbor", "harbour", "port", "marina", "swim"]) {
    if (allTokens.has(t)) {
      return {
        url: withUtm("/greece-by-yacht", "anchorage"),
        label: "Greece by Yacht — editorial",
        matched: `anchorage:${t}`,
        category: "anchorage",
      };
    }
  }

  // ── 6. Final fallback — fleet page (better than raw homepage for
  //     story viewers since most are inventory-curious). ──
  return {
    url: withUtm("/charter-yacht-greece", "homepage_fallback"),
    label: "Charter Yacht Greece — fleet",
    matched: "fallback",
    category: "homepage_fallback",
  };
}
