// Weekly LinkedIn Intelligence cron — Monday 06:00 UTC (09:00 Athens).
//
// Purpose: George needs B2B lead-gen leverage on LinkedIn but has no
// LinkedIn API access yet (CMA approval pending). This cron runs every
// Monday morning and pushes a Telegram briefing with:
//
//   1. Five LinkedIn outreach categories he should target this week
//   2. Example target profile per category (name + role + angle)
//   3. Pre-drafted personalized opener for each
//
// Powered by Gemini using known industry intelligence — these are
// PROMPTS for George to act on, not LinkedIn-API-driven targets. As
// soon as LinkedIn CMA lands, we'll wire actual profile fetching.

import { NextResponse } from "next/server";
import { aiChat } from "@/lib/ai";
import { sendTelegram } from "@/lib/telegram";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM_PROMPT = `You are George Yachts' LinkedIn outreach strategist. Each week you select 5 high-leverage outreach targets for George (Managing Broker, Athens-based, IYBA member, late-2025 brokerage, Greek-waters exclusive).

RULES:
- Targets must be REALISTIC profiles likely to exist on LinkedIn — not invented names. Use generic industry-typical roles + employers + cities.
- Each category should be DIFFERENT (avoid 5 of the same type).
- Output strict JSON in the exact format:
{
  "week_theme": "1-line strategic theme for this week",
  "targets": [
    {
      "category": "string — e.g. 'NYC luxury travel advisor'",
      "example_profile": "Plausible name + role + employer + city",
      "why_them": "1 line on why this person is high-leverage",
      "opener_draft": "2-3 line personalized DM in George's voice — peer-to-peer, broker-to-pro, no fluff"
    }
  ]
}

Voice for openers: warm but professional. Lead with a SPECIFIC reason you reached out (not 'wanted to connect'). Reference their employer or specialty. Mention George Yachts ONCE, briefly. End with a low-friction question or value-offer (NOT a meeting request).

Greek/English: openers in English unless target is Greek (then Greek opener).`;

const FALLBACK_BRIEFING = {
  week_theme: "B2B partner expansion in Greek diaspora + UHNW concierge",
  targets: [
    {
      category: "NYC luxury travel advisor (Greek diaspora focus)",
      example_profile: "Senior Travel Advisor at Indagare or Embark Beyond — New York City",
      why_them: "NYC-Greek diaspora UHNW travelers represent the highest-LTV segment for crewed Greek charters.",
      opener_draft: "Hi [Name] — saw you're at [Employer] and noticed your team handles Greece itineraries for HNW clients. I'm Athens-based, IYBA member, and run a boutique brokerage focused exclusively on Greek waters. If you ever need a real broker on the ground (not a directory), happy to be on call. No pitch — just want you to have a name.",
    },
    {
      category: "London concierge director — Mediterranean specialty",
      example_profile: "Head of Travel at Quintessentially or John Paul Group — London",
      why_them: "London concierge networks book €100K+ Med charters routinely; one warm intro = repeat business.",
      opener_draft: "Hi [Name] — your London team's Greek itineraries have been on my radar. We run a small Athens brokerage (IYBA, MYBA contracts) with a curated 60+ yacht fleet. If you're ever between brokers for a Greek charter request, I'd love a chance to quote alongside your incumbent. Same-day proposals.",
    },
    {
      category: "Aegean charter agency partner (Greek market)",
      example_profile: "Charter Manager at a fleet operator like Kavas, Istion, or Fyly — Athens",
      why_them: "Local agencies see retail demand we don't reach; we have boutique-market access they lack.",
      opener_draft: "[First name] γεια — εδώ Γιώργος Μπινιάρης από George Yachts (IYBA, Νέα Κηφισιά). Έχουμε αρχίσει να βλέπουμε requests από outreach που δεν fitάρουν στο portfolio μας — αν ψάχνεις partner για split commissions ή boutique fleet access, ας μιλήσουμε.",
    },
    {
      category: "Miami/FL luxury yacht broker (cross-referral)",
      example_profile: "Charter Broker at a Florida brokerage like Northrop & Johnson or Worth Avenue Yachts — Miami",
      why_them: "FL brokers send US clients to Med summer; reciprocal referral = no ad spend, instant warm leads.",
      opener_draft: "Hi [Name] — Athens-based IYBA broker here. We do Greek waters exclusively. If you ever have US clients wanting a Mediterranean charter and you don't have a Greek partner, happy to handle Greek-leg sourcing for your client (direct-to-you commission split). Currently splitting with a few Newport firms; expanding selectively.",
    },
    {
      category: "Greek tourism press / luxury travel journalist",
      example_profile: "Travel writer at Boat International, Robb Report, or Greek-diaspora outlets — anywhere",
      why_them: "1 quoted feature in a Tier-1 publication = 3-6 month inquiry uplift + permanent brand authority.",
      opener_draft: "Hi [Name] — fan of your [Outlet] Greek-waters coverage. I'm a working IYBA broker in Athens with first-hand 2026 market data (booking velocity, Meltemi shifts, Iran-conflict redirect impact on Med charter). If you're ever working a Greek-yacht story and need on-the-record industry color, happy to be a source. No PR firm in between.",
    },
  ],
};

export async function GET() {
  try {
    const sb = createServiceClient();

    // Pull recent CRM context to ground the suggestions
    const { data: warmContacts } = await sb
      .from("contacts")
      .select("first_name, last_name, company, email, source")
      .limit(10);

    const ctxBlock = warmContacts && warmContacts.length
      ? `Recent warm CRM contacts: ${warmContacts
          .map((c: any) => `${c.company || c.email || "—"}`)
          .filter((s: string) => s !== "—")
          .slice(0, 5)
          .join(", ")}.`
      : "(no recent contacts available)";

    let briefing = FALLBACK_BRIEFING;
    try {
      const raw = await aiChat(
        SYSTEM_PROMPT,
        `Generate this week's 5 LinkedIn outreach targets for George Yachts.\n\nContext: ${ctxBlock}\n\nWeek of: ${new Date().toISOString().slice(0, 10)}.\n\nReturn the JSON.`,
        { maxTokens: 1500, temperature: 0.6 },
      );
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          const parsed = JSON.parse(m[0]);
          if (parsed.targets && Array.isArray(parsed.targets) && parsed.targets.length >= 3) {
            briefing = parsed;
          }
        } catch {
          /* fallback */
        }
      }
    } catch (e) {
      console.error("[linkedin-intel] AI failed, using fallback:", e);
    }

    // Build Telegram message
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lines = [
      `💼 <b>LinkedIn Intel — Week of ${new Date().toISOString().slice(0, 10)}</b>`,
      ``,
      `<b>🎯 Theme:</b> ${escape(briefing.week_theme || "Lead generation focus")}`,
      ``,
      `<b>5 targets αυτή την εβδομάδα:</b>`,
      ``,
    ];
    for (let i = 0; i < (briefing.targets || []).length; i++) {
      const t = briefing.targets[i];
      lines.push(
        `<b>${i + 1}. ${escape(t.category || "Target")}</b>`,
        `<i>Profile:</i> ${escape(t.example_profile || "—")}`,
        `<i>Why:</i> ${escape(t.why_them || "—")}`,
        ``,
        `<b>Opener:</b>`,
        `<code>${escape(t.opener_draft || "—")}</code>`,
        ``,
      );
    }
    lines.push(
      `<i>👉 Πάρε ένα target/μέρα. 5 LinkedIn DMs/εβδομάδα = 1-2 conversations/μήνα = 1 partnership/τρίμηνο.</i>`,
    );

    await sendTelegram(lines.join("\n")).catch((e) => {
      console.error("[linkedin-intel] Telegram failed:", e);
    });

    // Persist for the dashboard
    await sb.from("settings").upsert({
      key: `linkedin_intel_${new Date().toISOString().slice(0, 10)}`,
      value: JSON.stringify(briefing),
    });

    return NextResponse.json({
      ok: true,
      targets_count: briefing.targets?.length ?? 0,
      theme: briefing.week_theme,
    });
  } catch (e: any) {
    console.error("[linkedin-intel] FAILED:", e);
    await sendTelegram(
      `⚠️ <b>LinkedIn intel cron crashed</b>\n<code>${(e?.message ?? "unknown").slice(0, 300)}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}
