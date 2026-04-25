// /api/cockpit/contact-intel — AI-powered intelligence for ANY contact.
//
// POST { contact_id } → {
//   summary           : 2-3 line AI summary of who this is + history
//   category          : auto-detected (b2b_partner | concierge | direct_client | press | agent | unknown)
//   suggested_actions : top 3 next-best actions
//   talking_points    : 3-5 specific things to mention if you call/email them
//   probability_score : 0-100 likelihood to convert
// }
//
// Designed to be called from anywhere — the contact detail page,
// pre-call brief, mobile briefing, even mid-email composition. Pulls
// the contact's full footprint (CRM row + last 20 activities + notes)
// and feeds Gemini with a broker-strategist system prompt.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { scoreContact } from "@/lib/cockpit-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

// ─── Auto-categorization heuristics ──────────────────────────────────
// Don't ask the AI for category — domain matching is faster and more
// reliable. AI helps with summary + actions only.

const B2B_DOMAINS = [
  "kavas", "istion", "fyly", "ekkayachts", "yalcin", "yco-yachts",
  "fraseryachts", "edmiston", "burgessyachts", "camperandnicholsons",
  "iyc", "hill-robinson", "moonen", "boatinternational",
];
const CONCIERGE_DOMAINS = [
  "indagare", "quintessentially", "johnpaul", "travelive", "amexlife",
  "fivetwo", "blackbook", "amancities", "fourseasons", "rosewood",
  "amanresorts", "ritzcarlton", "starrluxurycars",
];
const PRESS_DOMAINS = [
  "robbreport", "boatint", "boatinternational", "yachtreport", "luxurytravel",
  "condenast", "departures", "townandcountry", "amexlife", "wsj",
  "bloomberg", "bbc", "ft.com",
];
const PERSONAL_DOMAINS = [
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
  "me.com", "live.com", "aol.com",
];

function detectCategory(email: string | null, company: string | null): string {
  const e = (email || "").toLowerCase();
  const c = (company || "").toLowerCase();
  const haystack = `${e} ${c}`;
  if (B2B_DOMAINS.some((d) => haystack.includes(d))) return "b2b_partner";
  if (CONCIERGE_DOMAINS.some((d) => haystack.includes(d))) return "concierge";
  if (PRESS_DOMAINS.some((d) => haystack.includes(d))) return "press";
  if (PERSONAL_DOMAINS.some((d) => e.endsWith("@" + d))) return "direct_client";
  // Has a custom domain → likely B2B / company
  if (e.includes("@") && !PERSONAL_DOMAINS.some((d) => e.endsWith("@" + d))) {
    return "b2b_partner";
  }
  return "unknown";
}

const CATEGORY_LABELS: Record<string, string> = {
  b2b_partner: "B2B Partner / Charter Agency",
  concierge: "Concierge / Travel Agent",
  press: "Press / Media",
  direct_client: "Direct Client (UHNW)",
  agent: "Travel Agent",
  unknown: "Unclassified",
};

const SYSTEM_PROMPT = `You are George Yachts' senior brokerage analyst. For each contact, produce:

1. SUMMARY (2-3 lines): who this is, what they want, where they are in the funnel. Concrete. Not "interested party" — specific.

2. SUGGESTED ACTIONS (exactly 3): in priority order. Each: short verb + what to do. E.g. "Call Halilcan today and offer Lavrio embarkation alternative."

3. TALKING POINTS (3-5): specific things to mention if you reach out. Reference past activity, deal stage, market context. NOT generic.

Return strict JSON:
{
  "summary": "...",
  "suggested_actions": ["...", "...", "..."],
  "talking_points": ["...", "...", "...", "..."]
}

Tone: peer-to-peer, broker-to-broker analytical. No fluff. Greek or English depending on context. If data is thin, say so explicitly.`;

interface IntelRequest {
  contact_id: string;
}

export async function POST(request: NextRequest) {
  const sb = createServiceClient();
  let body: IntelRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { contact_id } = body;
  if (!contact_id) {
    return NextResponse.json({ error: "contact_id required" }, { status: 400 });
  }

  // Pull full contact context
  const { data: contact } = await sb
    .from("contacts")
    .select(
      "id, first_name, last_name, email, company, charter_fee, commission_earned, charter_vessel, charter_start_date, charter_end_date, payment_status, last_activity_at, notes, source, pipeline_stage:pipeline_stages(name), pipeline_stage_id",
    )
    .eq("id", contact_id)
    .single();
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 });
  }

  const c: any = contact;
  const stageName = Array.isArray(c.pipeline_stage)
    ? c.pipeline_stage[0]?.name
    : c.pipeline_stage?.name;
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.email || "—";
  const category = detectCategory(c.email, c.company);

  const { data: activities } = await sb
    .from("activities")
    .select("type, description, metadata, created_at")
    .eq("contact_id", contact_id)
    .order("created_at", { ascending: false })
    .limit(20);
  const { data: notesData } = await sb
    .from("notes")
    .select("content, created_at")
    .eq("contact_id", contact_id)
    .order("created_at", { ascending: false })
    .limit(5);

  const activityLog = (activities ?? [])
    .map((a: any) => {
      const date = new Date(a.created_at).toISOString().slice(0, 10);
      return `[${date}] ${a.type}: ${(a.description || "").slice(0, 200)}`;
    })
    .join("\n");

  const notesText = (notesData ?? [])
    .map((n: any) => `· ${(n.content || "").slice(0, 300)}`)
    .join("\n");

  const probabilityScore = scoreContact({
    charter_fee: c.charter_fee,
    payment_status: c.payment_status,
    pipeline_stage_name: stageName,
    last_activity_at: c.last_activity_at,
  });

  // Build user message for AI
  const dealBlock =
    c.charter_fee && c.charter_fee > 0
      ? `Active deal: ${c.charter_vessel ?? "TBD"} · ${c.charter_start_date ?? "—"} → ${c.charter_end_date ?? "—"} · €${c.charter_fee.toLocaleString()} · payment: ${c.payment_status ?? "—"}`
      : "No active charter deal.";

  const userMsg = `Contact: ${fullName} <${c.email ?? "—"}>
Company: ${c.company ?? "—"}
Stage: ${stageName ?? "—"}
Source: ${c.source ?? "—"}
Auto-detected category: ${CATEGORY_LABELS[category] ?? category}
Probability score: ${probabilityScore}/100
Last activity: ${c.last_activity_at ?? "never"}
Internal notes (CRM): ${(c.notes || "").slice(0, 400) || "none"}

${dealBlock}

Recent activity log (${activities?.length ?? 0} entries):
${activityLog || "(no activity logged)"}

Notes (${notesData?.length ?? 0}):
${notesText || "(no manual notes)"}

Now produce the JSON intel.`;

  try {
    const raw = await aiChat(SYSTEM_PROMPT, userMsg, {
      maxTokens: 800,
      temperature: 0.4,
    });
    // Extract JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let parsed: any = null;
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        /* fall through */
      }
    }
    if (!parsed) {
      // Fallback: degrade gracefully
      parsed = {
        summary: `${fullName} — ${stageName ?? "active"} contact, ${category}.`,
        suggested_actions: ["Review activity log", "Determine next step", "Schedule follow-up"],
        talking_points: ["Recent activity context", "Market timing", "Specific yacht options"],
      };
    }
    return NextResponse.json({
      contact_id,
      contact_name: fullName,
      contact_email: c.email,
      stage: stageName,
      category,
      category_label: CATEGORY_LABELS[category] ?? category,
      probability_score: probabilityScore,
      summary: parsed.summary,
      suggested_actions: parsed.suggested_actions || [],
      talking_points: parsed.talking_points || [],
      generated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "AI failed" },
      { status: 500 },
    );
  }
}
