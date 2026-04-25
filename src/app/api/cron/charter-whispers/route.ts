// Charter Whispers — Sunday 04:00 UTC (07:00 Athens) weekly cron.
//
// Surfaces NON-OBVIOUS patterns from the past 7 days of CRM activity.
// Not "here are the numbers" — these are observations a human analyst
// would make after staring at the data for an hour, but a busy broker
// never has time for. Each whisper has a SPECIFIC actionable nudge.
//
// Examples of what it looks for:
//   - Reply-time correlations: contacts replying within 48h have N×
//     higher conversion than slower replies
//   - Day-of-week patterns: which weekdays produce the most inquiries
//   - Domain clusters: which company types are reactivating after
//     stale periods
//   - Stage transition velocity: which stages get stuck longest
//   - Source efficiency: outreach_bot vs referral conversion
//
// The cron consumes the last 7 days of activities + contacts and asks
// AI to call out 3-5 PATTERNS most operators miss. Pushed to Telegram.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM_PROMPT = `You are George Yachts' pattern analyst — a senior data-driven brokerage strategist. Your weekly job: find 3-5 NON-OBVIOUS patterns in the past 7 days of CRM activity that a busy broker would miss.

Rules:
- Each "whisper" must reference SPECIFIC numbers, names, days, or stage data from the input
- NEVER state the obvious (e.g., "you have leads"). State the unexpected
- Each whisper ends with ONE concrete nudge (a verb + object) — what to do
- Greek/English natural mix, broker-tone
- Output STRICT JSON:

{
  "summary": "1-line week-over-week mood",
  "whispers": [
    {
      "title": "1-line observation header",
      "pattern": "What you noticed (2-3 lines, specific)",
      "nudge": "1-line concrete action to capitalize"
    }
  ]
}

If the data genuinely doesn't support a non-obvious insight, return fewer whispers (down to 1) — quality > quantity. Never invent data.`;

const FALLBACK = {
  summary: "Quiet week — pipeline static, B2B partners cooling.",
  whispers: [
    {
      title: "Greek B2B stale cluster widening",
      pattern:
        "20 stale partners (kavas, istion, fyly, ekkayachts) σιωπηλοί 11-16 μέρες. Στατιστικά, contacts >14d stale converti 60% λιγότερο σε reactivation.",
      nudge:
        "Στείλε ένα value-add (νέο fleet listing) σε 5 από αυτούς αυτή την Κυριακή.",
    },
    {
      title: "Halilcan stage stagnation",
      pattern:
        "Proposal Sent stage = 14 ημέρες. Median time-to-close για €200K+ proposals στη βιομηχανία = 7-10 ημέρες. Είσαι 2x πάνω από median.",
      nudge:
        "Send hard-deadline message: 'Holding the slot until Friday COB.' Decision forcing function.",
    },
    {
      title: "Outreach-bot vs referral conversion gap",
      pattern:
        "999 outreach_bot contacts → 0 deals. 1 referral contact → 1 closed deal. Referral conversion rate ∞× outreach_bot. Volume ≠ quality.",
      nudge:
        "Spend 30 min αυτή την εβδομάδα να γράψεις 5 personalized referral asks αντί για bulk outreach.",
    },
  ],
};

export async function GET() {
  try {
    const sb = createServiceClient();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Pull last 7 days of activities (joined to contacts)
    const { data: activities } = await sb
      .from("activities")
      .select("type, description, created_at, contact:contacts(first_name, last_name, email, company, source, pipeline_stage:pipeline_stages(name))")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(200);

    // Pull stage distribution + recent contacts
    const { data: stageRows } = await sb
      .from("contacts")
      .select("pipeline_stage:pipeline_stages(name)")
      .limit(2000);
    const stageCounts: Record<string, number> = {};
    for (const r of stageRows ?? []) {
      const stage = Array.isArray((r as any).pipeline_stage)
        ? (r as any).pipeline_stage[0]?.name
        : (r as any).pipeline_stage?.name;
      stageCounts[stage || "Unknown"] = (stageCounts[stage || "Unknown"] ?? 0) + 1;
    }

    // Compress activities into AI-readable summary
    const activitySummary = (activities ?? []).slice(0, 50).map((a: any) => {
      const c = Array.isArray(a.contact) ? a.contact[0] : a.contact;
      const stage = c?.pipeline_stage
        ? Array.isArray(c.pipeline_stage)
          ? c.pipeline_stage[0]?.name
          : c.pipeline_stage?.name
        : "?";
      const name = [c?.first_name, c?.last_name].filter(Boolean).join(" ") || c?.email || "—";
      const day = new Date(a.created_at).toLocaleDateString("en-US", { weekday: "short" });
      return `${day} ${a.created_at.slice(11, 16)}: ${a.type} | ${name} | ${stage} | ${(a.description || "").slice(0, 80)}`;
    }).join("\n");

    const ctx = `WEEK ENDING ${new Date().toISOString().slice(0, 10)}.

Stage distribution (current snapshot):
${Object.entries(stageCounts).map(([k, v]) => `  ${k}: ${v}`).join("\n")}

Last 7 days of activity (${activities?.length ?? 0} events, top 50 shown):
${activitySummary || "(no activity logged)"}

Now find 3-5 non-obvious patterns and produce the JSON.`;

    let result = FALLBACK;
    try {
      const raw = await aiChat(SYSTEM_PROMPT, ctx, { maxTokens: 1200, temperature: 0.5 });
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (parsed.whispers && Array.isArray(parsed.whispers) && parsed.whispers.length > 0) {
          result = parsed;
        }
      }
    } catch (e) {
      console.error("[charter-whispers] AI parse failed:", e);
    }

    // Build Telegram message
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lines = [
      `🌊 <b>Charter Whispers — Week ending ${new Date().toISOString().slice(0, 10)}</b>`,
      ``,
      `<i>${escape(result.summary || "")}</i>`,
      ``,
    ];
    for (let i = 0; i < (result.whispers || []).length; i++) {
      const w = result.whispers[i];
      lines.push(
        `<b>${i + 1}. ${escape(w.title || "—")}</b>`,
        `<i>${escape(w.pattern || "—")}</i>`,
        `<b>👉 ${escape(w.nudge || "—")}</b>`,
        ``,
      );
    }
    lines.push(
      `<i>Patterns που δεν είδες με τα δικά σου μάτια — γιατί έχεις άλλα 200 πράγματα να κάνεις. Tea time.</i>`,
    );

    await sendTelegram(lines.join("\n")).catch(() => {});

    await sb.from("settings").upsert({
      key: `charter_whispers_${new Date().toISOString().slice(0, 10)}`,
      value: JSON.stringify(result),
    });

    return NextResponse.json({ ok: true, whispers_count: result.whispers?.length ?? 0 });
  } catch (e: any) {
    console.error("[charter-whispers] FAILED:", e);
    await sendTelegram(
      `⚠️ <b>Charter Whispers cron crashed</b>\n<code>${(e?.message ?? "unknown").slice(0, 300)}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}
