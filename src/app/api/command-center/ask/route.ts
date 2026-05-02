// /api/command-center/ask — "Ask the Cockpit" Q&A endpoint.
//
// George types a question on the Command Center surface; we pre-fetch a
// rich context bundle from Supabase (snapshot + a couple keyword-driven
// extras) and hand it to the AI helper as JSON. The LLM reasons over
// that bundle and replies in plain English/Greek. No raw SQL from the
// model — context is bounded server-side, so the answer either comes
// from real data or the model says "I don't have that".
//
// Newsletter is intentionally out of context — that surface lives at
// /dashboard/newsletter and the operator drives it directly.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { buildCommandCenterSnapshot } from "@/lib/command-center-snapshot";

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM_PROMPT = `You are the GY Cockpit assistant — embedded in George P. Biniaris's CRM Command Center for George Yachts Brokerage House LLC.

You answer questions about pipeline, deals, contacts, and operations using ONLY the JSON CONTEXT provided. Rules:

1. Cite numbers exactly as they appear in CONTEXT. Don't estimate or extrapolate.
2. If the answer isn't in CONTEXT, say so plainly: "I don't have that in today's snapshot — open <relevant section> for the full view."
3. Be concise. 1-3 short sentences for simple questions; bullet list for "list" questions. Don't lecture.
4. Match George's language: if the question is Greek, answer Greek; if English, English.
5. Format currency as €X,XXX. Never invent figures.
6. When relevant, suggest the dashboard path (e.g. /dashboard/charters, /dashboard/contacts) for drill-down.
7. NEVER mention the newsletter — that surface is operated directly at /dashboard/newsletter.
8. If the question is about something the snapshot doesn't surface (e.g. "tell me about <person>"), say what the snapshot DOES show that's relevant and point to the contact page.

Style: direct, money-aware, no preamble. Open with the answer, not "Sure!".`;

function detectKeywords(q: string): {
  wantsTopDeals: boolean;
  wantsRevenue: boolean;
  wantsStale: boolean;
  wantsContact: string | null;
} {
  const lower = q.toLowerCase();
  const wantsTopDeals = /\b(top|biggest|largest|major|μεγαλύτερ|κορυφαί)\b/.test(lower) && /\b(deal|charter|client|πελάτ|συμφωνί)\b/.test(lower);
  const wantsRevenue = /\b(revenue|commission|earn|paid|income|έσοδ|αμοιβ|προμήθει|κέρδ)\b/.test(lower);
  const wantsStale = /\b(stale|cold|silent|forgotten|παγωμέν|κρύ|σιωπηλ)\b/.test(lower);
  // crude: pull a possible name token (capitalised word > 3 chars)
  const nameMatch = q.match(/\b([A-ZΑ-ΩΆ-Ώ][a-zα-ωά-ώ]{3,})\b/);
  const wantsContact = nameMatch ? nameMatch[1] : null;
  return { wantsTopDeals, wantsRevenue, wantsStale, wantsContact };
}

async function gatherExtras(sb: any, question: string): Promise<Record<string, unknown>> {
  const extras: Record<string, unknown> = {};
  const k = detectKeywords(question);

  try {
    if (k.wantsTopDeals) {
      const { data } = await sb
        .from("contacts")
        .select(
          "first_name, last_name, charter_vessel, charter_fee, payment_status, charter_start_date, pipeline_stages(name)",
        )
        .not("charter_fee", "is", null)
        .order("charter_fee", { ascending: false })
        .limit(10);
      extras.top_deals_by_fee = (data ?? []).map((c: any) => ({
        name: [c.first_name, c.last_name].filter(Boolean).join(" "),
        vessel: c.charter_vessel,
        fee_eur: c.charter_fee,
        payment_status: c.payment_status,
        start_date: c.charter_start_date,
        stage: c.pipeline_stages?.name ?? null,
      }));
    }

    if (k.wantsRevenue) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
      const [{ data: paidThisMonth }, { data: paidThisYear }] = await Promise.all([
        sb
          .from("contacts")
          .select("charter_fee, last_activity_at")
          .eq("payment_status", "paid")
          .gte("last_activity_at", monthStart),
        sb
          .from("contacts")
          .select("charter_fee")
          .eq("payment_status", "paid")
          .gte("last_activity_at", yearStart),
      ]);
      const sum = (rows: any[]) =>
        (rows ?? []).reduce((acc, r) => acc + Number(r.charter_fee || 0), 0);
      extras.revenue = {
        paid_this_month_eur: sum(paidThisMonth ?? []),
        paid_this_year_eur: sum(paidThisYear ?? []),
        currency: "EUR",
        note: "Sum of charter_fee on contacts marked payment_status=paid in the date window. Not GAAP — this is broker-tracked gross.",
      };
    }

    if (k.wantsStale) {
      const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const { data } = await sb
        .from("contacts")
        .select("first_name, last_name, last_activity_at, charter_vessel, pipeline_stages(name)")
        .lt("last_activity_at", cutoff)
        .in("pipeline_stages.name", ["Hot", "Warm", "Negotiation", "Proposal Sent"])
        .limit(10);
      extras.stale_warm_leads = (data ?? []).map((c: any) => ({
        name: [c.first_name, c.last_name].filter(Boolean).join(" "),
        last_activity_at: c.last_activity_at,
        vessel: c.charter_vessel,
        stage: c.pipeline_stages?.name ?? null,
      }));
    }

    if (k.wantsContact) {
      // Try a fuzzy ilike on first_name OR last_name OR company.
      const term = `%${k.wantsContact}%`;
      const { data } = await sb
        .from("contacts")
        .select(
          "id, first_name, last_name, company, email, charter_vessel, charter_fee, payment_status, last_activity_at, pipeline_stages(name)",
        )
        .or(`first_name.ilike.${term},last_name.ilike.${term},company.ilike.${term}`)
        .limit(3);
      extras.matching_contacts = (data ?? []).map((c: any) => ({
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(" "),
        company: c.company,
        email: c.email,
        vessel: c.charter_vessel,
        fee_eur: c.charter_fee,
        payment_status: c.payment_status,
        last_activity_at: c.last_activity_at,
        stage: c.pipeline_stages?.name ?? null,
        path: `/dashboard/contacts/${c.id}`,
      }));
    }
  } catch (e: any) {
    extras._extras_error = String(e?.message ?? e);
  }

  return extras;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const question = String(body?.question ?? "").trim();
    if (!question) {
      return NextResponse.json({ error: "question required" }, { status: 400 });
    }
    if (question.length > 500) {
      return NextResponse.json({ error: "question too long (max 500 chars)" }, { status: 400 });
    }
    if (!process.env.AI_API_KEY) {
      return NextResponse.json(
        { error: "AI_API_KEY not configured on this deployment" },
        { status: 503 },
      );
    }

    const sb = createServiceClient();
    const [snapshot, extras] = await Promise.all([
      buildCommandCenterSnapshot(sb),
      gatherExtras(sb, question),
    ]);

    const context = {
      generated_at: snapshot.generated_at,
      metrics: snapshot.metrics,
      priorities: snapshot.priorities,
      pipeline_top: snapshot.pipeline,
      threats: snapshot.threats,
      systems: snapshot.systems,
      extras,
    };

    const userMessage = `QUESTION: ${question}

CONTEXT:
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\``;

    const answer = await aiChat(SYSTEM_PROMPT, userMessage, {
      maxTokens: 600,
      temperature: 0.3,
    });

    return NextResponse.json({
      ok: true,
      answer: answer.trim(),
      context_keys: Object.keys(extras),
    });
  } catch (e: any) {
    console.error("[command-center/ask] failed:", e);
    return NextResponse.json(
      { error: e?.message ?? "ask failed" },
      { status: 500 },
    );
  }
}
