// /api/admin/inbox-tag-debug — return the raw AI response for one
// contact, plus the parsed result. Used to diagnose why every contact
// was getting tagged as cold_lead.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";

export const runtime = "nodejs";

const SYSTEM = `You categorize George Yachts contacts. George is a yacht charter broker in Greece.

CRITICAL OUTPUT RULES:
- Output ONLY the raw JSON object. NO markdown fences. NO \`\`\`json. NO prose before or after.
- Start your response with the open brace { and end with the close brace }. Nothing else.
- Schema: {"tags":[{"tag":"<TAG>","confidence":<0..1>}, ...]}
- Allowed TAG values: travel_advisor, charter_client, b2b_partner, press, vendor, cold_lead

REMEMBER: raw JSON only. No fences.`;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get("email");
  if (!email) {
    return NextResponse.json({ error: "pass ?email=..." }, { status: 400 });
  }
  const sb = createServiceClient();
  const { data: c } = await sb
    .from("contacts")
    .select("email, first_name, last_name, company, notes")
    .ilike("email", email)
    .single();
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: acts } = await sb
    .from("activities")
    .select("metadata")
    .eq("contact_id", (await sb.from("contacts").select("id").ilike("email", email).single()).data?.id ?? "")
    .in("type", ["email_inbound", "email_received", "email_sent", "reply"])
    .order("created_at", { ascending: false })
    .limit(10);
  const subjects = (acts ?? [])
    .map((a) => (a.metadata as { subject?: string } | null)?.subject ?? null)
    .filter((s): s is string => !!s);

  const userMsg = JSON.stringify({
    email: c.email,
    name: [c.first_name, c.last_name].filter(Boolean).join(" "),
    company: c.company,
    notes: c.notes,
    domain_kind: c.email?.includes("@gmail.") ? "personal" : "business",
    recent_subjects: subjects.slice(0, 8),
  });

  const raw = await aiChat(SYSTEM, userMsg, {
    maxTokens: 500,
    temperature: 0.2,
  });

  const match = raw.match(/\{[\s\S]*\}/);
  let parsed: unknown = null;
  let parseError: string | null = null;
  if (match) {
    try {
      parsed = JSON.parse(match[0]);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  } else {
    parseError = "no JSON object found in response";
  }

  return NextResponse.json({
    contact: c,
    activities_subjects: subjects,
    user_message_to_ai: userMsg,
    raw_ai_response: raw,
    json_match: match?.[0] ?? null,
    parsed,
    parse_error: parseError,
  });
}
