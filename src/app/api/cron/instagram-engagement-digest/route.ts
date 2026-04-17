// @ts-nocheck
import { NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";
import { aiChat } from "@/lib/ai";

// Cron: 11:07 UTC daily (= 14:07 Athens in summer).
//
// Feature #5 — Strategic engagement digest (RELATIONSHIP BUILDING).
// DAILY ROTATION: picks 15 targets from a pool of 45+, different each day.
// FRESH COMMENTS: Gemini generates new comments daily (not hardcoded).

// ── FULL TARGET POOL (45 accounts across 6 categories) ─────────────────

const ALL_TARGETS = [
  // Travel advisors (10)
  { handle: "@virtuoso.travel", url: "https://www.instagram.com/virtuoso.travel/", category: "\u{1F6CE} Travel advisors" },
  { handle: "@signaturetravelnetwork", url: "https://www.instagram.com/signaturetravelnetwork/", category: "\u{1F6CE} Travel advisors" },
  { handle: "@mrandmrssmith", url: "https://www.instagram.com/mrandmrssmith/", category: "\u{1F6CE} Travel advisors" },
  { handle: "@tlmagazine", url: "https://www.instagram.com/tlmagazine/", category: "\u{1F6CE} Travel advisors" },
  { handle: "@cntraveler", url: "https://www.instagram.com/cntraveler/", category: "\u{1F6CE} Travel advisors" },
  { handle: "@taboragency", url: "https://www.instagram.com/taboragency/", category: "\u{1F6CE} Travel advisors" },
  { handle: "@frosch_travel", url: "https://www.instagram.com/frosch_travel/", category: "\u{1F6CE} Travel advisors" },
  { handle: "@luxurytraveladvisor", url: "https://www.instagram.com/luxurytraveladvisor/", category: "\u{1F6CE} Travel advisors" },
  { handle: "@departures_mag", url: "https://www.instagram.com/departures_mag/", category: "\u{1F6CE} Travel advisors" },
  { handle: "@robbreport", url: "https://www.instagram.com/robbreport/", category: "\u{1F6CE} Travel advisors" },

  // Greek luxury hotels (10)
  { handle: "@hotelgrandebretagne", url: "https://www.instagram.com/hotelgrandebretagne/", category: "\u{1F3DB} Greek luxury hotels" },
  { handle: "@amanzoe", url: "https://www.instagram.com/amanzoe/", category: "\u{1F3DB} Greek luxury hotels" },
  { handle: "@cavotagoohotel", url: "https://www.instagram.com/cavotagoohotel/", category: "\u{1F3DB} Greek luxury hotels" },
  { handle: "@canavessantorini", url: "https://www.instagram.com/canavessantorini/", category: "\u{1F3DB} Greek luxury hotels" },
  { handle: "@bluepalaceresort", url: "https://www.instagram.com/bluepalaceresort/", category: "\u{1F3DB} Greek luxury hotels" },
  { handle: "@costanavarino", url: "https://www.instagram.com/costanavarino/", category: "\u{1F3DB} Greek luxury hotels" },
  { handle: "@nikki_beach_porto_heli", url: "https://www.instagram.com/nikki_beach_porto_heli/", category: "\u{1F3DB} Greek luxury hotels" },
  { handle: "@oneandonlykeanisland", url: "https://www.instagram.com/oneandonlykeanisland/", category: "\u{1F3DB} Greek luxury hotels" },
  { handle: "@fourseasons", url: "https://www.instagram.com/fourseasons/", category: "\u{1F3DB} Greek luxury hotels" },
  { handle: "@belmondhotels", url: "https://www.instagram.com/belmondhotels/", category: "\u{1F3DB} Greek luxury hotels" },

  // Private aviation (5)
  { handle: "@vistajet", url: "https://www.instagram.com/vistajet/", category: "\u2708\uFE0F Private aviation" },
  { handle: "@netjets", url: "https://www.instagram.com/netjets/", category: "\u2708\uFE0F Private aviation" },
  { handle: "@xabordjets", url: "https://www.instagram.com/xabordjets/", category: "\u2708\uFE0F Private aviation" },
  { handle: "@flyexclusive", url: "https://www.instagram.com/flyexclusive/", category: "\u2708\uFE0F Private aviation" },
  { handle: "@jetsmarter", url: "https://www.instagram.com/jetsmarter/", category: "\u2708\uFE0F Private aviation" },

  // Mediterranean lifestyle (5)
  { handle: "@discovergreece", url: "https://www.instagram.com/discovergreece/", category: "\u{1F30A} Mediterranean lifestyle" },
  { handle: "@greeceofficial_", url: "https://www.instagram.com/greeceofficial_/", category: "\u{1F30A} Mediterranean lifestyle" },
  { handle: "@mediterranean_lifestyle", url: "https://www.instagram.com/mediterranean_lifestyle/", category: "\u{1F30A} Mediterranean lifestyle" },
  { handle: "@visitgreece.gr", url: "https://www.instagram.com/visitgreece.gr/", category: "\u{1F30A} Mediterranean lifestyle" },
  { handle: "@aegeanislands", url: "https://www.instagram.com/aegeanislands/", category: "\u{1F30A} Mediterranean lifestyle" },

  // Yacht industry (10)
  { handle: "@boatinternational", url: "https://www.instagram.com/boatinternational/", category: "\u{1F6F3} Yacht industry" },
  { handle: "@burgabordjets", url: "https://www.instagram.com/burgessyachts/", category: "\u{1F6F3} Yacht industry" },
  { handle: "@fraseryachts", url: "https://www.instagram.com/fraseryachts/", category: "\u{1F6F3} Yacht industry" },
  { handle: "@camperandnicholsons", url: "https://www.instagram.com/camperandnicholsons/", category: "\u{1F6F3} Yacht industry" },
  { handle: "@abordjachtingen", url: "https://www.instagram.com/yachtcharterfleet/", category: "\u{1F6F3} Yacht industry" },
  { handle: "@superyachttimes", url: "https://www.instagram.com/superyachttimes/", category: "\u{1F6F3} Yacht industry" },
  { handle: "@myabordjacht", url: "https://www.instagram.com/theyachtguy/", category: "\u{1F6F3} Yacht industry" },
  { handle: "@charterworld", url: "https://www.instagram.com/charterworld/", category: "\u{1F6F3} Yacht industry" },
  { handle: "@yachtingmagazine", url: "https://www.instagram.com/yachtingmagazine/", category: "\u{1F6F3} Yacht industry" },
  { handle: "@dockwalk", url: "https://www.instagram.com/dockwalk/", category: "\u{1F6F3} Yacht industry" },

  // Luxury lifestyle (5)
  { handle: "@quintessentially", url: "https://www.instagram.com/quintessentially/", category: "\u{1F48E} Luxury lifestyle" },
  { handle: "@christies", url: "https://www.instagram.com/christies/", category: "\u{1F48E} Luxury lifestyle" },
  { handle: "@sothebys", url: "https://www.instagram.com/sothebys/", category: "\u{1F48E} Luxury lifestyle" },
  { handle: "@monocle_magazine", url: "https://www.instagram.com/monocle_magazine/", category: "\u{1F48E} Luxury lifestyle" },
  { handle: "@wallpapermag", url: "https://www.instagram.com/wallpapermag/", category: "\u{1F48E} Luxury lifestyle" },
];

const DAILY_PICK_COUNT = 15;

/** Pick N targets using date-based rotation (different 15 each day) */
function pickDailyTargets(count: number): typeof ALL_TARGETS {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const pool = [...ALL_TARGETS];

  // Deterministic shuffle using day as seed
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (dayOfYear * 31 + i * 7) % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Ensure category diversity: at least 2 from each category if possible
  const categories = [...new Set(pool.map(t => t.category))];
  const picked: typeof ALL_TARGETS = [];
  const used = new Set<string>();

  // Round 1: 2 per category
  for (const cat of categories) {
    const catTargets = pool.filter(t => t.category === cat && !used.has(t.handle));
    for (const t of catTargets.slice(0, 2)) {
      if (picked.length >= count) break;
      picked.push(t);
      used.add(t.handle);
    }
  }

  // Round 2: fill remaining
  for (const t of pool) {
    if (picked.length >= count) break;
    if (!used.has(t.handle)) {
      picked.push(t);
      used.add(t.handle);
    }
  }

  return picked;
}

/** Generate a fresh comment using Gemini */
async function generateComment(handle: string, category: string): Promise<string> {
  try {
    const prompt = `Write a single Instagram comment from George Biniaris (Greek yacht charter broker) for ${handle} (${category}).

RULES:
- ONE genuine insight, specific to their industry/niche
- Reference something concrete about their brand or what they're known for
- NO sales pitch, NO links, NO hashtags, NO emojis overuse (max 1)
- Sound like a knowledgeable peer, not a fan
- 2-3 sentences max
- DO NOT start with "Love" or "Great" or "Amazing"
- Reference Greece/Mediterranean/yachting naturally if it fits

COMMENT:`;

    const result = await aiChat(
      "You write authentic Instagram comments. One comment only, no quotes, no explanation.",
      prompt
    );
    return result.replace(/^["']|["']$/g, "").trim();
  } catch {
    // Fallback: generic but still decent
    return `The attention to detail here is something the yachting world could learn from. Quality content that respects the audience's time.`;
  }
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TG = { disablePreview: true } as const;

export async function GET() {
  const targets = pickDailyTargets(DAILY_PICK_COUNT);
  let sent = 0;

  const intro = [
    `\u{1F440} <b>Daily Engagement Targets \u2014 Relationship Builders</b>`,
    ``,
    `Today's ${targets.length} targets (rotated daily from pool of ${ALL_TARGETS.length}):`,
    ``,
    `<b>Rule of thumb:</b>`,
    `\u2022 ONE genuine insight per comment`,
    `\u2022 Specific to their latest post`,
    `\u2022 No sales language, no links`,
    `\u2022 10\u201315 min total, ~1 min per account`,
    ``,
    `Tap handle \u2192 open IG \u2192 come back \u2192 long-press comment \u2192 copy \u2192 paste.`,
    ``,
    `Let\u2019s build relationships. \u{1F30A}`,
  ].join("\n");

  if (await sendTelegram(intro, TG)) sent++;

  for (let i = 0; i < targets.length; i++) {
    await sleep(800);

    const t = targets[i];
    const comment = await generateComment(t.handle, t.category);

    const msg = [
      `<b>${i + 1}/${targets.length} \u2014 <a href="${t.url}">${esc(t.handle)}</a></b>`,
      t.category,
      ``,
      `\u{1F4AC} Ready-to-paste comment:`,
      ``,
      esc(comment),
    ].join("\n");

    if (await sendTelegram(msg, TG)) sent++;
  }

  return NextResponse.json({
    ok: true,
    messages_sent: sent,
    target_count: targets.length,
    pool_size: ALL_TARGETS.length,
    rotation: "daily",
  });
}
