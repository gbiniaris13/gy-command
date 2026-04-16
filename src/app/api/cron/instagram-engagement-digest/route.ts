// @ts-nocheck
import { NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";

// Cron: 11:07 UTC daily (= 14:07 Athens in summer).
//
// Feature #5 — Strategic engagement digest (RELATIONSHIP BUILDING).
//
// Sends 16 separate Telegram messages: 1 intro + 15 individual targets,
// each with a copy-paste-ready comment. George long-presses on his
// iPhone, copies the comment, and pastes it into Instagram. The comment
// is ALWAYS the last thing in the message so long-press grabs clean text.

const TARGETS = [
  // Travel advisors
  {
    handle: "@virtuoso.travel",
    category: "\u{1F6CE} Travel advisors",
    comment: `The "Virtuoso lens" on destinations is what separates advisors from aggregators. Greece's quiet archipelagos \u2014 Lefkada, Folegandros \u2014 are where discerning clients are heading next. Beautifully curated feed.`,
  },
  {
    handle: "@signaturetravelnetwork",
    category: "\u{1F6CE} Travel advisors",
    comment: `Signature's advisor-first model is exactly why the luxury travel market still belongs to humans, not algorithms. Love seeing the member spotlights \u2014 that personal expertise is the product.`,
  },
  {
    handle: "@mrandmrssmith",
    category: "\u{1F6CE} Travel advisors",
    comment: `Mr & Mrs Smith has always understood that "boutique" is about point of view, not square meterage. The Greek island selections on your platform are some of the most thoughtfully edited out there.`,
  },
  {
    handle: "@tlmagazine",
    category: "\u{1F6CE} Travel advisors",
    comment: `T+L's reporting on the Mediterranean shift this year has been spot-on \u2014 the itineraries clients are asking for now look nothing like 2019. Appreciate the editorial depth.`,
  },
  {
    handle: "@cntraveler",
    category: "\u{1F6CE} Travel advisors",
    comment: `Cond\u00e9 Nast Traveler consistently writes about Greece the way locals would \u2014 not the postcard version. That's rare and worth saying out loud.`,
  },

  // Greek luxury hotels
  {
    handle: "@hotelgrandebretagne",
    category: "\u{1F3DB} Greek luxury hotels",
    comment: `The GB remains the quiet benchmark for Athens hospitality \u2014 the kind of place where service is felt, not performed. A fixed point on the map for our clients arriving in the city.`,
  },
  {
    handle: "@amanzoe",
    category: "\u{1F3DB} Greek luxury hotels",
    comment: `Aman Zoe's restraint is what makes it extraordinary \u2014 the Peloponnese land speaks, and the architecture gets out of the way. Monastic luxury at its most honest.`,
  },
  {
    handle: "@cavotagoohotel",
    category: "\u{1F3DB} Greek luxury hotels",
    comment: `Cavo Tagoo rewrote the vocabulary of Mykonos design. Every angle of the property photographs like it was built for this exact light.`,
  },
  {
    handle: "@canavessantorini",
    category: "\u{1F3DB} Greek luxury hotels",
    comment: `Canaves continues to prove that Oia luxury doesn't need to shout. The caldera suites and the attention to the guest journey \u2014 from arrival to departure \u2014 is masterclass-level.`,
  },
  {
    handle: "@bluepalaceresort",
    category: "\u{1F3DB} Greek luxury hotels",
    comment: `Blue Palace's Elounda positioning is underrated \u2014 the eastern Crete coastline is one of the most cinematic stretches of the Aegean, and the resort captures it beautifully.`,
  },

  // Private aviation
  {
    handle: "@vistajet",
    category: "\u2708\uFE0F Private aviation",
    comment: `The VistaJet fleet philosophy \u2014 global consistency, locally tuned service \u2014 translates perfectly into how UHNW clients think about their entire journey. Athens and Mykonos are increasingly the second leg of that itinerary.`,
  },
  {
    handle: "@netjets",
    category: "\u2708\uFE0F Private aviation",
    comment: `NetJets' commitment to crew continuity is something the yachting world studies closely. The same faces, trip after trip \u2014 that's where trust actually lives.`,
  },

  // Mediterranean lifestyle
  {
    handle: "@discovergreece",
    category: "\u{1F30A} Mediterranean lifestyle",
    comment: `Discover Greece does the quiet work of reminding people that the country is 6,000 islands, not five. The off-peak and off-map features are some of the most valuable tourism content out there.`,
  },
  {
    handle: "@greeceofficial_",
    category: "\u{1F30A} Mediterranean lifestyle",
    comment: `Love seeing the Greek tourism board highlight the shoulder seasons \u2014 May and September are when the country actually breathes. The best time to experience it, honestly.`,
  },
  {
    handle: "@mediterranean_lifestyle",
    category: "\u{1F30A} Mediterranean lifestyle",
    comment: `The Med lifestyle is a philosophy, not a geography \u2014 slow meals, long sea days, no urgency. This feed captures that rhythm without falling into clich\u00e9. Well done.`,
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET() {
  const total = TARGETS.length;
  let sent = 0;

  // Message 1 — Intro
  const intro = [
    `\u{1F440} <b>Daily Engagement Targets \u2014 Relationship Builders</b>`,
    ``,
    `These are the accounts whose followers are our future clients.`,
    ``,
    `Rule of thumb:`,
    `\u2022 ONE genuine insight per comment`,
    `\u2022 Specific to their post`,
    `\u2022 No sales language, no links`,
    `\u2022 10\u201315 min total, ~1 min per account`,
    ``,
    `I\u2019m sending ${total} messages below \u2014 one per target, each with a ready-to-paste comment. Long-press \u2192 copy \u2192 paste into Instagram.`,
    ``,
    `Let\u2019s build relationships. \u{1F30A}`,
  ].join("\n");

  const introOk = await sendTelegram(intro);
  if (introOk) sent++;

  // Messages 2–16 — One per target, 500ms apart
  for (let i = 0; i < TARGETS.length; i++) {
    await sleep(500);

    const t = TARGETS[i];
    const pos = i + 1;
    // Comment is the LAST thing in the message — no footer after it —
    // so George can long-press at the bottom and copy clean text.
    const msg = [
      `<b>${pos}/${total} \u2014 ${t.handle}</b>`,
      t.category,
      ``,
      `\u{1F4AC} Ready-to-paste comment:`,
      ``,
      t.comment,
    ].join("\n");

    const ok = await sendTelegram(msg);
    if (ok) sent++;
  }

  return NextResponse.json({
    ok: true,
    messages_sent: sent,
    messages_expected: total + 1,
    target_count: total,
    window: "daily 11:07 UTC",
  });
}
