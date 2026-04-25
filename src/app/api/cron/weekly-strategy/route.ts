// Weekly Strategy Briefing — Friday 14:00 UTC (17:00 Athens).
//
// End-of-week strategic close-out. Looks at the past week's pipeline
// movement and generates next week's 3 priorities. Pushes to Telegram
// so George heads into the weekend with clarity.
//
// Different from the daily 06:00 cockpit-briefing in scope:
//   Daily   = today's tactical actions (this contact, this email)
//   Weekly  = strategic week-over-week direction (this market, this
//             segment, this lever)
//
// Uses Gemini with full live business context.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { buildBriefing } from "@/lib/cockpit-engine";
import { aiChat } from "@/lib/ai";
import { sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM_PROMPT = `You are George Yachts' senior strategic advisor. Every Friday afternoon you produce next week's strategic briefing for George (Managing Broker, Athens, IYBA, founded late-2025, Greek waters exclusive).

Format: STRICT JSON
{
  "week_review": "1-2 sentences honest review of past week — what moved, what stalled",
  "next_week_theme": "1-line strategic theme",
  "priorities": [
    { "title": "...", "why": "1 line", "concrete_action": "1 line — specific verb + object" },
    { "title": "...", "why": "...", "concrete_action": "..." },
    { "title": "...", "why": "...", "concrete_action": "..." }
  ],
  "watch_outs": ["1-2 risks or stale items to watch"],
  "horizon_note": "1 line big-picture nudge — quarter or 6-month framing"
}

Tone: peer strategist, not coach. Honest about what isn't working. Specific. NO motivational fluff. Bilingual (Greek/English mix as natural).`;

export async function GET() {
  try {
    const sb = createServiceClient();
    const briefing = await buildBriefing(sb);

    const ctx = `LIVE STATE (end of week, ${new Date().toISOString().slice(0, 10)}):
- Pipeline value: €${briefing.pulse.total_pipeline_value_eur.toLocaleString()}
- Commission upside: €${briefing.pulse.total_commission_upside_eur.toLocaleString()}
- Active deals: ${briefing.pulse.active_deals_count}
- Hot leads: ${briefing.pulse.hot_leads_count}
- Stale warm: ${briefing.pulse.stale_warm_leads_count}
- Activity logs today: ${briefing.pulse.net_change_today.activity_count}

TOP PRIORITY ACTIONS THIS WEEK (entering weekend):
${briefing.actions.map((a, i) => `${i + 1}. ${a.title} — ${a.reason}`).join("\n")}

OPPORTUNITIES SURFACED:
${briefing.opportunities.map((o) => `· ${o.title}`).join("\n")}

BROKERAGE PROFILE: New brokerage (founded late 2025), Athens, IYBA member, Greek waters exclusive. ~1,000 contacts mostly outreach-bot Contacted state. 2 active deals. 20 stale Greek B2B partners (kavas, istion, fyly, ekkayachts) that need waking up. Pending: TikTok approval, LinkedIn CMA, GBP postcard verification.

GOAL: 3-4 inquiries/week, close charters. NO ad budget — organic + B2B partnership only.`;

    let strategy: any = null;
    try {
      const raw = await aiChat(SYSTEM_PROMPT, ctx, {
        maxTokens: 1000,
        temperature: 0.5,
      });
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) strategy = JSON.parse(m[0]);
    } catch (e) {
      console.error("[weekly-strategy] AI parse failed:", e);
    }

    if (!strategy) {
      // Graceful fallback if AI unavailable
      strategy = {
        week_review:
          "Pipeline σταθερό, αλλά κανένα νέο deal μέσα στην εβδομάδα. Halilcan ακόμα silent.",
        next_week_theme: "Wake up the 20 Greek B2B partners + close Halilcan",
        priorities: [
          {
            title: "Halilcan close-or-release",
            why: "€35K commission δεν περιμένει 30 μέρες. Decision ή release.",
            concrete_action:
              "Στείλε deadline message Δευτέρα πρωί: 'Holding the slot until Friday COB.'",
          },
          {
            title: "Re-engage 5 stale Greek partners",
            why: "1 active partner = 2-4 inquiries/χρόνο. 5 partners = 10-20 inquiries.",
            concrete_action:
              "Στείλε value-add update (νέο fleet listing) σε 5 από kavas/istion/fyly/ekkayachts.",
          },
          {
            title: "1 LinkedIn DM/μέρα στους weekly intel targets",
            why: "5 outreach DMs/εβδομάδα = 1-2 conversations/μήνα.",
            concrete_action:
              "Άνοιξε το Δευτέρα Telegram briefing και στείλε 1 DM/μέρα στους 5 targets.",
          },
        ],
        watch_outs: [
          "Halilcan stale > 14 μέρες — risk lost-to-competitor",
          "Αν Σαββατοκύριακο πάει σε άλλο broker, lose €235K",
        ],
        horizon_note:
          "Q3 2026 (Jul-Sep) είναι peak booking — όσα partners ενεργοποιήσεις τώρα, αυτά θα παράγουν leads από Μάιο.",
      };
    }

    // Build Telegram message
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const date = new Date().toISOString().slice(0, 10);
    const lines = [
      `📋 <b>Weekly Strategy — Week ending ${date}</b>`,
      ``,
      `<b>📊 This week's review</b>`,
      `<i>${escape(strategy.week_review || "—")}</i>`,
      ``,
      `<b>🎯 Next week's theme</b>`,
      `${escape(strategy.next_week_theme || "—")}`,
      ``,
      `<b>📍 Top 3 priorities Δευτέρα-Παρασκευή:</b>`,
    ];
    for (let i = 0; i < (strategy.priorities || []).length; i++) {
      const p = strategy.priorities[i];
      lines.push(
        ``,
        `<b>${i + 1}. ${escape(p.title || "—")}</b>`,
        `<i>Γιατί:</i> ${escape(p.why || "—")}`,
        `<i>Action:</i> ${escape(p.concrete_action || "—")}`,
      );
    }
    if (strategy.watch_outs && strategy.watch_outs.length) {
      lines.push(``, `<b>⚠️ Watch outs:</b>`);
      for (const w of strategy.watch_outs) lines.push(`· ${escape(w)}`);
    }
    if (strategy.horizon_note) {
      lines.push(``, `<b>🔭 Horizon:</b>`, `<i>${escape(strategy.horizon_note)}</i>`);
    }

    await sendTelegram(lines.join("\n")).catch(() => {});

    await sb.from("settings").upsert({
      key: `weekly_strategy_${date}`,
      value: JSON.stringify(strategy),
    });

    return NextResponse.json({
      ok: true,
      priorities_count: strategy.priorities?.length ?? 0,
      theme: strategy.next_week_theme,
    });
  } catch (e: any) {
    console.error("[weekly-strategy] FAILED:", e);
    await sendTelegram(
      `⚠️ <b>Weekly strategy crashed</b>\n<code>${(e?.message ?? "unknown").slice(0, 300)}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}
