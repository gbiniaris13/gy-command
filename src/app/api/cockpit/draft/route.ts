// /api/cockpit/draft — generates a personalized email draft for a
// CockpitAction. POST { contact_id, draft_kind } → { subject, body }.
//
// Pulls the contact's full context from Supabase (CRM row + last 10
// activities + deal data) and feeds it to Gemini with a broker-voice
// system prompt. Output is editable, never auto-sent.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are George P. Biniaris writing as Managing Broker of George Yachts Brokerage House (Athens, IYBA member). Tone: warm but professional, broker-to-client (or broker-to-partner). Specific, concrete, no marketing fluff. Always sign as "George" with the brokerage name underneath. Email format: Subject line on first line, blank line, body. No emojis except at sign-off.

Voice rules:
- Open with something specific (yacht name, dates, region) — never "checking in"
- Add ONE piece of broker intel per email (market signal, weather note, owner update)
- Honest if something is risky or wrong — never overpromise
- Always offer a clear next step (call, video, decision deadline, alternative)
- Greek-waters context only (Cyclades, Ionian, Saronic, Sporades)
- Keep under 220 words including signature
- Never invent dates, prices, or yacht details — use only what's given`;

interface DraftRequest {
  contact_id: string;
  draft_kind?: string;
}

export async function POST(request: NextRequest) {
  const sb = createServiceClient();
  let body: DraftRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { contact_id, draft_kind } = body;
  if (!contact_id) {
    return NextResponse.json({ error: "contact_id required" }, { status: 400 });
  }

  // 1. Pull contact + recent activities + stage name
  const { data: contact, error: cErr } = await sb
    .from("contacts")
    .select(
      "id, first_name, last_name, email, company, charter_fee, commission_earned, charter_vessel, charter_start_date, charter_end_date, payment_status, last_activity_at, notes, source, pipeline_stage:pipeline_stages(name)",
    )
    .eq("id", contact_id)
    .single();
  if (cErr || !contact) {
    return NextResponse.json(
      { error: cErr?.message || "contact not found" },
      { status: 404 },
    );
  }

  const { data: activities } = await sb
    .from("activities")
    .select("type, description, metadata, created_at")
    .eq("contact_id", contact_id)
    .order("created_at", { ascending: false })
    .limit(10);

  // 2. Build context for AI
  const c: any = contact;
  const stageName = Array.isArray(c.pipeline_stage)
    ? c.pipeline_stage[0]?.name
    : c.pipeline_stage?.name;
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.email || "—";

  const activityLog = (activities ?? [])
    .map((a: any) => {
      const date = new Date(a.created_at).toISOString().slice(0, 10);
      return `[${date}] ${a.type}: ${a.description?.slice(0, 200) || ""}`;
    })
    .join("\n");

  const dealBlock =
    c.charter_fee && c.charter_fee > 0
      ? `Active deal: ${c.charter_vessel ?? "TBD vessel"} — ${c.charter_start_date ?? "TBD start"} to ${c.charter_end_date ?? "TBD end"} — €${c.charter_fee.toLocaleString()} charter fee. Payment status: ${c.payment_status ?? "unknown"}.`
      : "No active deal — pre-proposal stage.";

  const userMsg = `Contact: ${fullName} <${c.email ?? "no-email"}>
Company: ${c.company ?? "—"}
Pipeline stage: ${stageName ?? "—"}
Source: ${c.source ?? "—"}
Last activity: ${c.last_activity_at ?? "never"}
Internal notes: ${c.notes?.slice(0, 300) ?? "none"}

${dealBlock}

Recent activity log:
${activityLog || "no activity logged"}

Draft kind requested: ${draft_kind ?? "follow_up"}

Write a single email (subject + body) that:
- Re-engages without sounding desperate
- References at least one specific yacht/date/region detail from above
- Includes ONE broker-side market intel (Cyclades booking velocity, Meltemi window, owner availability, MYBA contract milestone — pick what fits)
- Ends with a clear next step (call slot, decision deadline, or alternative offer)`;

  try {
    const raw = await aiChat(SYSTEM_PROMPT, userMsg, {
      maxTokens: 600,
      temperature: 0.6,
    });
    // Parse: first line = subject, rest = body
    const lines = raw.trim().split("\n");
    let subject = "";
    let bodyText = "";
    // Prefer "Subject:" prefix if present
    const subjMatch = raw.match(/^\s*Subject:\s*(.+)$/m);
    if (subjMatch) {
      subject = subjMatch[1].trim();
      bodyText = raw.replace(/^\s*Subject:\s*.+$/m, "").trim();
    } else {
      subject = lines[0].trim();
      bodyText = lines.slice(1).join("\n").trim();
    }
    return NextResponse.json({
      subject,
      body: bodyText,
      contact_id,
      contact_name: fullName,
      contact_email: c.email,
      generated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "AI generation failed" },
      { status: 500 },
    );
  }
}
