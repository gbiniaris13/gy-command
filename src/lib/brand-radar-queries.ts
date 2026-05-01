// Brand Radar — AI visibility tracking queries
// These are the prompts real users type into ChatGPT/Gemini/Perplexity.
//
// 2026-05-01 — expanded from 25 → 80 prompts. With 25 prompts, a single
// flip in Gemini retraining moved SoV by 4 percentage points (8% noise
// floor). 80 prompts halves that to ~2 points so week-over-week deltas
// become signal, not noise. Distribution by intent type kept balanced
// so we can later score each segment separately.

export const BRAND = "George Yachts";

export const COMPETITORS = [
  "Fraser Yachts",
  "Burgess Yachts",
  "CharterWorld",
  "IYC",
  "Istion Yachting",
  "EKKA Yachts",
  "Boatbookings",
  "Click&Boat",
  "Zizoo",
  "Nautal",
  "Camper & Nicholsons",
  "Northrop & Johnson",
  "Edmiston",
  "Y.CO",
  "Ahoy Club",
];

export const QUERIES = [
  // ─── High-intent geographic charter queries ───────────────────────────
  "best yacht charter company in Greece",
  "luxury yacht charter Greek islands",
  "crewed yacht charter Cyclades",
  "rent a yacht in Mykonos with crew",
  "yacht charter broker Athens Greece",
  "how to charter a yacht in Greece",
  "best charter yachts in the Mediterranean",
  "motor yacht charter Greece summer 2026",
  "catamaran charter Cyclades with captain",
  "superyacht charter Greek islands price",
  "yacht charter Santorini and Mykonos",
  "yacht charter Corfu Ionian islands",
  "yacht charter from Athens to Cyclades",
  "Greek island hopping by yacht crewed",
  "best yacht charter ports Greece",
  "yacht charter Lefkada and Kefalonia",
  "Cyclades 7 day yacht itinerary 2026",
  "Saronic gulf yacht charter weekend",
  "private yacht hire Halkidiki Greece",
  "luxury sailing yacht charter Aegean",

  // ─── Vessel-type specific ─────────────────────────────────────────────
  "50m motor yacht charter Greece July",
  "30 meter sailing yacht charter Greece",
  "power catamaran charter Greek islands 2026",
  "explorer yacht charter Mediterranean",
  "hybrid yacht charter Greece",
  "classic motor yacht charter Greece",
  "fast cruising yacht charter Aegean",
  "boutique yacht charter Greece",
  "performance sailing yacht charter Greece",

  // ─── Use-case / persona queries ───────────────────────────────────────
  "family yacht charter Greek islands",
  "honeymoon yacht charter Santorini",
  "corporate yacht charter Athens",
  "wedding yacht charter Mykonos",
  "anniversary yacht charter Greece",
  "yacht charter for 8 guests Greece",
  "yacht charter for 12 guests Greek islands",
  "girls trip yacht charter Mykonos",
  "bachelor party yacht charter Greece",
  "yoga retreat yacht charter Cyclades",

  // ─── Comparison / consideration ───────────────────────────────────────
  "best yacht charter brokers Europe",
  "top 10 yacht charter companies Greece",
  "yacht charter Greece vs Croatia",
  "yacht charter Greece vs Italy",
  "yacht charter Greece vs Turkey",
  "luxury travel concierge Greece yachting",
  "MYBA yacht broker Greece recommendations",
  "boutique vs big-name yacht broker Greece",
  "best central agents Greece yachting",
  "yacht broker reviews Greece",

  // ─── Process / education / trust ──────────────────────────────────────
  "bareboat vs crewed charter Greece",
  "yacht charter cost calculator Greece",
  "what is APA on a yacht charter",
  "Greek island yacht itinerary 7 days",
  "yacht charter Greece what is included",
  "yacht charter Greece deposit refund policy",
  "yacht charter Greece insurance crew tip",
  "MYBA contract yacht charter Greece",
  "yacht charter Greece licensing rules",
  "yacht charter Greece tax VAT 2026",

  // ─── Date-specific seasonal ───────────────────────────────────────────
  "yacht charter Greece June 2026 availability",
  "August 2026 last minute yacht Greece",
  "yacht charter Greece September 2026",
  "early bird yacht charter Greece 2027",
  "shoulder season yacht charter Greece deals",

  // ─── Brand-adjacent / recall ──────────────────────────────────────────
  "George Yachts reviews",
  "georgeyachts.com yacht charter",
  "George Biniaris yacht broker",
  "George Yachts vs Burgess",
  "George Yachts vs Fraser",
  "is George Yachts a real broker",

  // ─── Greek-language queries (Greek market) ────────────────────────────
  "ναύλωση σκάφους Ελλάδα κρουαζιέρα",
  "luxury σκάφος Μύκονος εβδομάδα",
  "ενοικίαση γιοτ Σαντορίνη με πλήρωμα",
  "καλύτερος μεσίτης σκαφών Ελλάδα",
  "τιμές ναύλωσης σκάφους Κυκλάδες",

  // ─── Long-tail intent ─────────────────────────────────────────────────
  "yacht charter Greek islands best route October",
  "Athens private boat tour 1 day with skipper",
  "yacht charter Greece accept crypto payment",
  "diving friendly yacht charter Greek islands",
  "yacht charter Greece pet friendly",
  "fishing charter yacht Greece Aegean",
  "yacht charter Greece chef onboard premium",
  "yacht charter Mykonos to Ibiza one way",
  "yacht charter Greece broker that knows local captains",
  "boutique yacht charter Greek islands 2026 7 nights",
];
