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
import OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase-server";
import { buildCommandCenterSnapshot } from "@/lib/command-center-snapshot";
import { PROJECT_KNOWLEDGE } from "@/lib/cockpit-project-knowledge";
import { searchCode } from "@/lib/code-search";

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM_PROMPT = `You are the GY Cockpit assistant — embedded in George P. Biniaris's CRM Command Center for George Yachts Brokerage House LLC.

You answer questions about pipeline, deals, contacts, operations, AND how the CRM itself works. Two sources of truth:

1. **JSON CONTEXT** — live snapshot data + on-demand extras. Cite numbers EXACTLY as they appear here. No estimation.
2. **PROJECT KNOWLEDGE** — slim architecture map of the gy-command CRM (subsystems, tables, crons, conventions). Use this when the user asks about HOW things work, where something lives, what cron runs when, etc.

Rules:
- If a data question can't be answered from CONTEXT, say so plainly and point to the relevant /dashboard/* path. Don't fabricate data.
- If a question is about how the system works, answer from PROJECT KNOWLEDGE. If you genuinely don't have that info either, say "Not in my reference — check ARCHITECTURE.md or PLAYBOOKS.md in the repo."
- Be concise. 1-3 short sentences for simple questions; bullet list for "list" questions. No preamble like "Sure!".
- Match George's language: Greek question → Greek answer; English → English. Greeklish (Greek-in-Latin) → respond in Greek.
- Format currency as €X,XXX. Never invent figures.
- When you reference a subsystem, suggest the dashboard path or repo file.
- NEVER document or modify newsletter internals — those belong to the public site repo. Read-only references to the operator UI at /dashboard/newsletter are fine.
- If the user asks a follow-up that depends on the prior turns of this conversation, USE the conversation history. If history is empty, treat as the first turn.

Style: direct, money-aware, action-oriented. Open with the answer.

PROJECT KNOWLEDGE:
${PROJECT_KNOWLEDGE}`;

function detectKeywords(q: string): {
  wantsTopDeals: boolean;
  wantsRevenue: boolean;
  wantsStale: boolean;
  wantsContact: string | null;
  wantsCode: boolean;
} {
  const lower = q.toLowerCase();
  const wantsTopDeals = /\b(top|biggest|largest|major|μεγαλύτερ|κορυφαί)\b/.test(lower) && /\b(deal|charter|client|πελάτ|συμφωνί)\b/.test(lower);
  const wantsRevenue = /\b(revenue|commission|earn|paid|income|έσοδ|αμοιβ|προμήθει|κέρδ)\b/.test(lower);
  const wantsStale = /\b(stale|cold|silent|forgotten|παγωμέν|κρύ|σιωπηλ)\b/.test(lower);
  // crude: pull a possible name token (capitalised word > 3 chars)
  const nameMatch = q.match(/\b([A-ZΑ-ΩΆ-Ώ][a-zα-ωά-ώ]{3,})\b/);
  const wantsContact = nameMatch ? nameMatch[1] : null;
  // Code-lookup intent: "where", "ποιο αρχείο", function/file/cron/schema words,
  // or a direct file-extension reference, or an obvious symbol like camelCase.
  const wantsCode =
    /\b(where|how does|find|search|definition|defined|implement|file|αρχείο|πού|γραμμή|κώδικ|function|class|interface|cron|schema|migration|table|column|env var|export|import)\b/.test(lower) ||
    /\.(ts|tsx|js|sql|md)\b/.test(lower) ||
    /\b[a-z][a-z0-9]+(?:[A-Z][a-zA-Z0-9]+)+\b/.test(q); // camelCase identifier
  return { wantsTopDeals, wantsRevenue, wantsStale, wantsContact, wantsCode };
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

    if (k.wantsCode) {
      // Tier 4d — repo grep. Strip stop-words then search the code index.
      const stopWords = new Set([
        "where", "how", "does", "find", "search", "the", "is", "in", "of",
        "to", "for", "and", "or", "a", "an", "what", "when", "why",
        "show", "me", "tell", "explain", "πού", "ποιο", "αρχείο", "γραμμή",
        "που", "το", "η", "ο", "και", "για", "που", "βρίσκεται", "στο",
        "που", "πώς", "γιατί", "function", "file", "code",
      ]);
      const cleanQuery = question
        .toLowerCase()
        .split(/[\s,;:!?]+/)
        .filter((t) => t.length >= 2 && !stopWords.has(t))
        .join(" ");
      const hits = cleanQuery ? await searchCode(cleanQuery, { limit: 6 }) : [];
      extras.code_matches = hits.map((h) => ({
        path: h.path,
        lines: h.lines,
        score: h.path_score + h.content_score,
        // Top 4 matching lines
        matches: h.matches,
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

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

const MAX_HISTORY_TURNS = 10; // 5 exchanges

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const question = String(body?.question ?? "").trim();
    const rawHistory = Array.isArray(body?.history) ? body.history : [];

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

    // Sanitise history: trust nothing from the client, cap turns + length
    const history: HistoryTurn[] = rawHistory
      .filter((t: any) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
      .slice(-MAX_HISTORY_TURNS)
      .map((t: any) => ({
        role: t.role as "user" | "assistant",
        content: String(t.content).slice(0, 2000),
      }));

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

    // Live context goes WITH the current user turn so prior turns
    // don't carry stale data forward. The model always sees fresh
    // numbers for the current question.
    const userMessage = `QUESTION: ${question}

CONTEXT (live, for this turn):
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\``;

    const ai = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: process.env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
    });
    const model = process.env.AI_MODEL || "gemini-2.5-flash";

    const response = await ai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 600,
    });

    const answer = response.choices[0]?.message?.content?.trim() || "(empty answer)";

    return NextResponse.json({
      ok: true,
      answer,
      context_keys: Object.keys(extras),
      history_turns_used: history.length,
    });
  } catch (e: any) {
    console.error("[command-center/ask] failed:", e);
    return NextResponse.json(
      { error: e?.message ?? "ask failed" },
      { status: 500 },
    );
  }
}
