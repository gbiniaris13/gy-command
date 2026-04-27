// Pillar 2 — AI-driven contact tagger.
//
// Reads everything we know about a contact (signature, domain,
// recent email subjects) and asks Gemini to assign one or more
// category tags from the brief's vocabulary. Returns confidence
// per tag so the UI can flag low-confidence rows for review.
//
// Manually-overridden contacts (tags_overridden = true) are NEVER
// re-tagged — George's correction is permanent.

import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat } from "@/lib/ai";

export const TAG_VOCAB = [
  "travel_advisor",
  "charter_client",
  "b2b_partner",
  "press",
  "vendor",
  "cold_lead",
] as const;

export type Tag = (typeof TAG_VOCAB)[number];

export interface TagAssignment {
  tag: Tag;
  confidence: number; // 0..1
  source: "ai" | "manual";
}

interface ContactInput {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  notes: string | null;
  domain_kind: "personal" | "business" | "unknown";
  recent_subjects: string[];
}

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "icloud.com", "me.com", "aol.com",
  "protonmail.com", "proton.me",
]);

function domainKind(email: string | null): ContactInput["domain_kind"] {
  if (!email) return "unknown";
  const d = email.split("@")[1]?.toLowerCase();
  if (!d) return "unknown";
  if (PERSONAL_DOMAINS.has(d)) return "personal";
  return "business";
}

const SYSTEM = `You categorize George Yachts contacts. George is a yacht charter broker in Greece.

CRITICAL OUTPUT RULES:
- Output ONLY the raw JSON object. NO markdown fences. NO \`\`\`json. NO prose before or after.
- Start your response with the open brace { and end with the close brace }. Nothing else.
- Schema: {"tags":[{"tag":"<TAG>","confidence":<0..1>}, ...]}
- Allowed TAG values: travel_advisor, charter_client, b2b_partner, press, vendor, cold_lead
- Multi-tag fine (a person can be travel_advisor AND b2b_partner).
- If no clear signal: {"tags":[{"tag":"cold_lead","confidence":0.3}]}

Tag definitions:
- travel_advisor: agency name in signature/email domain, IATA/CLIA mentioned, "advisor"/"agent"/"travel" in title.
- charter_client: requested a yacht, signed proposal, family/personal email (gmail/icloud), conversation about specific dates.
- b2b_partner: yacht broker, charter manager, fleet operator, concierge, jet ops, villa rental ops, anyone who could refer clients TO George.
- press: media outlet domain, journalist/editor title, podcast/blog mention.
- vendor: invoicing, service provider (printing, photography, marketing).
- cold_lead: single inbound, unclear category.

Confidence:
- 0.9+: explicit signal (IATA number visible, magazine domain, signed contract).
- 0.7-0.8: strong inference (agency in company field + replies to outreach).
- 0.4-0.6: weak signal (gmail domain + first email).
- 0.3 or below: pure guess; only for cold_lead fallback.

REMEMBER: raw JSON only. No fences.`;

export async function tagContactWithAI(input: ContactInput): Promise<TagAssignment[]> {
  const userMsg = JSON.stringify({
    email: input.email,
    name: [input.first_name, input.last_name].filter(Boolean).join(" "),
    company: input.company,
    notes: input.notes,
    domain_kind: input.domain_kind,
    recent_subjects: input.recent_subjects.slice(0, 8),
  });
  let raw: string;
  try {
    raw = await aiChat(SYSTEM, userMsg, { maxTokens: 500, temperature: 0.2 });
  } catch (err) {
    console.error("[pillar2-tagger] AI call failed:", err);
    return [{ tag: "cold_lead", confidence: 0.3, source: "ai" }];
  }
  // Strip markdown fences if Gemini ignores the no-fence rule, then
  // extract the first {...} block.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) {
    console.error("[pillar2-tagger] no JSON in response:", raw.slice(0, 200));
    return [{ tag: "cold_lead", confidence: 0.3, source: "ai" }];
  }
  try {
    const parsed = JSON.parse(m[0]) as {
      tags?: Array<{ tag?: string; confidence?: number }>;
    };
    const valid = (parsed.tags ?? [])
      .filter((t): t is { tag: string; confidence: number } =>
        typeof t.tag === "string" &&
        typeof t.confidence === "number" &&
        (TAG_VOCAB as readonly string[]).includes(t.tag),
      )
      .map((t) => ({
        tag: t.tag as Tag,
        confidence: Math.max(0, Math.min(1, t.confidence)),
        source: "ai" as const,
      }));
    if (valid.length === 0)
      return [{ tag: "cold_lead", confidence: 0.3, source: "ai" }];
    return valid;
  } catch (err) {
    console.error("[pillar2-tagger] JSON parse failed:", err, raw);
    return [{ tag: "cold_lead", confidence: 0.3, source: "ai" }];
  }
}

/**
 * Tag a single contact: pulls fresh activity context, calls AI, persists
 * to contacts.tags_v2. Skips contacts whose tags were manually overridden.
 */
export async function tagOneContact(
  sb: SupabaseClient,
  contactId: string,
): Promise<{ skipped: boolean; tags: TagAssignment[] | null }> {
  const { data: c } = await sb
    .from("contacts")
    .select(
      "email, first_name, last_name, company, notes, tags_overridden",
    )
    .eq("id", contactId)
    .single();
  if (!c) return { skipped: true, tags: null };
  if (c.tags_overridden) return { skipped: true, tags: null };

  const { data: acts } = await sb
    .from("activities")
    .select("metadata")
    .eq("contact_id", contactId)
    .in("type", ["email_inbound", "email_received", "email_sent", "reply"])
    .order("created_at", { ascending: false })
    .limit(10);
  const subjects = (acts ?? [])
    .map((a) => (a.metadata as { subject?: string } | null)?.subject ?? null)
    .filter((s): s is string => !!s);

  const input: ContactInput = {
    email: c.email,
    first_name: c.first_name,
    last_name: c.last_name,
    company: c.company,
    notes: c.notes,
    domain_kind: domainKind(c.email),
    recent_subjects: subjects,
  };
  const tags = await tagContactWithAI(input);
  await sb
    .from("contacts")
    .update({
      tags_v2: tags,
      tags_analyzed_at: new Date().toISOString(),
    })
    .eq("id", contactId);
  return { skipped: false, tags };
}
