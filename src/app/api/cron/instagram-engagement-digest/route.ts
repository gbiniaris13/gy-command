// @ts-nocheck
import { NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";

// Cron: 11:07 UTC daily (= 14:07 Athens in summer).
//
// Feature #5 — Strategic engagement digest (RELATIONSHIP BUILDING).
//
// Previous version of this cron pulled handles from the ig_competitors
// table, which is correct data for the Competitor Watch dashboard but
// WRONG for engagement. We don't want to comment on other yacht
// brokers' posts — they're competitors, not partners. We want to
// engage with luxury travel advisors, DMCs, private aviation,
// Greek luxury hotels, and Mediterranean lifestyle content creators.
// Those are the people whose followers are our future clients.
//
// The list below is a curated seed — each handle is publicly known
// and fits one of the four target categories. George can reshuffle
// at any time by editing the constant. Domingo (Claude in Chrome)
// takes over the actual liking/commenting when George is at the
// laptop; the digest is the consistent daily nudge.

type Category = "travel_advisors" | "greek_luxury_hotels" | "private_aviation" | "mediterranean_lifestyle";

const TARGETS: Array<{ handle: string; category: Category; note: string }> = [
  // Travel advisors & luxury travel networks — our highest-leverage
  // relationship because their clients are our future charter guests
  { handle: "virtuoso.travel", category: "travel_advisors", note: "Luxury travel network" },
  { handle: "signaturetravelnetwork", category: "travel_advisors", note: "Signature Travel Network" },
  { handle: "mrandmrssmith", category: "travel_advisors", note: "Boutique hotel + travel" },
  { handle: "tlmagazine", category: "travel_advisors", note: "Travel + Leisure" },
  { handle: "cntraveler", category: "travel_advisors", note: "Condé Nast Traveler" },

  // Greek luxury hotels — natural companion stays for charter guests.
  // Relationship here gets mutual referral flow
  { handle: "hotelgrandebretagne", category: "greek_luxury_hotels", note: "Hotel Grande Bretagne, Athens" },
  { handle: "amanzoe", category: "greek_luxury_hotels", note: "Aman Zoe, Porto Heli" },
  { handle: "cavotagoohotel", category: "greek_luxury_hotels", note: "Cavo Tagoo, Mykonos" },
  { handle: "canavessantorini", category: "greek_luxury_hotels", note: "Canaves Oia, Santorini" },
  { handle: "bluepalaceresort", category: "greek_luxury_hotels", note: "Blue Palace, Elounda" },

  // Private aviation — direct UHNW overlap with yacht charter
  { handle: "vistajet", category: "private_aviation", note: "VistaJet" },
  { handle: "netjets", category: "private_aviation", note: "NetJets" },

  // Mediterranean lifestyle content — their audience is our audience
  { handle: "discovergreece", category: "mediterranean_lifestyle", note: "Official Greece travel" },
  { handle: "greeceofficial_", category: "mediterranean_lifestyle", note: "Greece official" },
  { handle: "mediterranean_lifestyle", category: "mediterranean_lifestyle", note: "Med lifestyle feed" },
];

const CATEGORY_LABEL: Record<Category, string> = {
  travel_advisors: "🛎 Travel advisors",
  greek_luxury_hotels: "🏛 Greek luxury hotels",
  private_aviation: "✈️ Private aviation",
  mediterranean_lifestyle: "🌊 Mediterranean lifestyle",
};

export async function GET() {
  // Group by category so the digest is scannable
  const grouped = new Map<Category, typeof TARGETS>();
  for (const t of TARGETS) {
    if (!grouped.has(t.category)) grouped.set(t.category, []);
    grouped.get(t.category)!.push(t);
  }

  const lines: string[] = [
    "👀 <b>Daily engagement targets — relationship builders</b>",
    "<i>These are the accounts whose followers are our future clients. Tap through, spend 1 min on the latest post, leave a GENUINE comment (not just an emoji). 10-15 min total.</i>",
    "",
  ];

  const categoryOrder: Category[] = [
    "travel_advisors",
    "greek_luxury_hotels",
    "private_aviation",
    "mediterranean_lifestyle",
  ];

  for (const cat of categoryOrder) {
    const rows = grouped.get(cat) ?? [];
    if (rows.length === 0) continue;
    lines.push(`<b>${CATEGORY_LABEL[cat]}</b>`);
    for (const r of rows) {
      lines.push(
        `• <a href="https://instagram.com/${r.handle}">@${r.handle}</a> — <i>${r.note}</i>`
      );
    }
    lines.push("");
  }

  lines.push(
    "<i>Rule of thumb: ONE genuine insight per comment (specific to their post), no sales language, no links. That's how brokers build white-glove relationships. When you're at the Chrome, tell Domingo \"help me comment on the Aman Zoe post\" and I'll narrate the flow.</i>"
  );

  const message = lines.join("\n");
  const sent = await sendTelegram(message);

  return NextResponse.json({
    ok: true,
    telegram_sent: sent,
    target_count: TARGETS.length,
    categories: Object.fromEntries(
      categoryOrder.map((c) => [c, (grouped.get(c) ?? []).length])
    ),
    window: "daily 11:07 UTC",
    note:
      "Targets are travel advisors, luxury hotels, private aviation, lifestyle — NOT yacht competitors",
  });
}
