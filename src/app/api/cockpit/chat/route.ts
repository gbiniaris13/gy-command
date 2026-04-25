// /api/cockpit/chat — brainstorm chat endpoint with FULL business
// context. Every message gets the live pipeline + briefing + recent
// pipeline trends in the system prompt so George can ask anything
// like "γιατί δεν κλείνω ναύλα Ιούνιο" and get answers grounded in
// his actual data.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { buildBriefing } from "@/lib/cockpit-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_BASE = `You are George Yachts' AI strategic advisor — a senior yacht-charter brokerage consultant who knows the Greek market, MYBA contracts, APA reconciliation, charter season dynamics, Meltemi weather impact, UHNW client psychology, and the broker-vs-agency competitive landscape.

You answer George P. Biniaris (Managing Broker, founded George Yachts late 2025). Tone: peer-to-peer, sharp, no fluff, bilingual (Greek/English depending on what he uses). Always ground answers in the live business data provided below — never speculate beyond it.

Style:
- Be specific: cite numbers from the data, names of contacts, exact stages
- Honest when the data is thin or contradicts intuition
- Suggest 1-3 concrete actions per answer when relevant
- Never repeat the data verbatim — synthesize
- If asked about external info (industry trends, competitor moves), say what you don't know rather than make it up`;

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
}

export async function POST(request: NextRequest) {
  const sb = createServiceClient();
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const messages = body.messages || [];
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "must end with user message" },
      { status: 400 },
    );
  }

  // Build live business context
  let context = "(no live data available)";
  try {
    const briefing = await buildBriefing(sb);
    const top3 = briefing.actions
      .map(
        (a, i) =>
          `${i + 1}. [${a.priority.toUpperCase()}] ${a.title}\n   Reason: ${a.reason}\n   Stage: ${a.stage ?? "—"} · €${a.expected_commission_eur.toLocaleString()} commission · ${a.days_stale}d stale`,
      )
      .join("\n");
    const oppText = briefing.opportunities
      .map((o) => `- ${o.title}: ${o.detail}`)
      .join("\n");

    context = `LIVE BUSINESS DATA (as of ${briefing.generated_at}):

PIPELINE PULSE:
- Total pipeline value: €${briefing.pulse.total_pipeline_value_eur.toLocaleString()}
- Total commission upside: €${briefing.pulse.total_commission_upside_eur.toLocaleString()}
- Active deals (charter_fee > 0): ${briefing.pulse.active_deals_count}
- Pending payments: ${briefing.pulse.pending_payments_count} totaling €${briefing.pulse.pending_payments_eur.toLocaleString()}
- Stale warm leads (7+ days no activity): ${briefing.pulse.stale_warm_leads_count}
- Hot leads: ${briefing.pulse.hot_leads_count}
- Total contacts in CRM: ${briefing.pulse.contacts_total.toLocaleString()}
- Activities logged today: ${briefing.pulse.net_change_today.activity_count}

TOP 3 PRIORITIZED ACTIONS:
${top3 || "(no priority actions today)"}

OPPORTUNITIES SURFACED:
${oppText || "(none)"}

BROKERAGE PROFILE:
- Founded late 2025 (very new — no historical client base to mine)
- Athens-based, Charilaou Trikoupi 190A, Nea Kifisia
- IYBA member, MYBA contract standard
- Greek waters exclusive (Cyclades, Ionian, Saronic, Sporades, Dodecanese)
- Outreach bots: Eleanna (1,076 prospects) + George (1,000 prospects), 50 emails/day each
- Site: georgeyachts.com (66 yachts, 18+ blog articles, full SEO/GEO foundation built)
- 37 cron automations (IG, FB, blog-to-social, Gmail CRM, calendar sync)
- Pending: TikTok app review, LinkedIn CMA approval`;
  } catch (e) {
    console.error("[cockpit/chat] context build failed:", e);
  }

  // Build messages for AI: system prompt with context + conversation
  const systemPrompt = `${SYSTEM_BASE}

${context}

When you reference contacts/deals/numbers, cite them as in the data. When the user asks something not answerable from this data, say so explicitly.`;

  const lastUserMsg = messages[messages.length - 1].content;
  // Compress prior turns
  const priorTurns = messages
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "George" : "Advisor"}: ${m.content}`)
    .join("\n\n");
  const userMessage = priorTurns
    ? `Prior conversation:\n${priorTurns}\n\nGeorge's new question: ${lastUserMsg}`
    : lastUserMsg;

  try {
    const reply = await aiChat(systemPrompt, userMessage, {
      maxTokens: 800,
      temperature: 0.5,
    });
    return NextResponse.json({
      role: "assistant",
      content: reply,
      generated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "AI failed" },
      { status: 500 },
    );
  }
}
