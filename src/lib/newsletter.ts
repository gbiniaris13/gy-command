// v3 Pillar 4 — Newsletter helpers.
//
// Two responsibilities:
//   1. Resolve audience filters → list of {contact_id, email, first_name}
//   2. Compose AI-generated body blocks (subject, intro, fleet
//      highlights, trip-prep tip) for the campaign's stream.
//
// This file does NOT send mail. Sending is gated through the
// approval flow in /api/admin/newsletter-* and George's hand on the
// keyboard.

import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat } from "@/lib/ai";

export type Stream = "general" | "advisor" | "bespoke";

export interface AudienceFilter {
  subscribed_to_newsletter?: boolean;
  has_email?: boolean;
  contact_type?: string | string[];
  country?: string | string[];
  source?: string | string[];
  network_source?: string | string[];
  excludes_minors?: boolean;
  segment_id?: string;
}

export interface AudienceMember {
  contact_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  contact_type: string | null;
}

const ALL_OPTED_IN_FILTER: AudienceFilter = {
  subscribed_to_newsletter: true,
  has_email: true,
  excludes_minors: true,
};

/**
 * Resolve a filter definition into a deduped list of audience members.
 * Skips contacts already unsubscribed and minors by default. Paginates
 * around the 1000-row REST cap.
 */
export async function resolveAudience(
  sb: SupabaseClient,
  filter: AudienceFilter,
): Promise<AudienceMember[]> {
  // If a segment_id is provided, hydrate the segment's filter_definition first.
  let effective: AudienceFilter = filter;
  if (filter.segment_id) {
    const { data: seg } = await sb
      .from("audience_segments")
      .select("filter_definition")
      .eq("id", filter.segment_id)
      .maybeSingle();
    if (seg?.filter_definition) {
      effective = {
        ...(seg.filter_definition as AudienceFilter),
        ...filter,
        segment_id: undefined,
      };
    }
  }

  const all: AudienceMember[] = [];
  let from = 0;
  while (from < 50000) {
    let q = sb
      .from("contacts")
      .select(
        "id, first_name, last_name, email, country, contact_type, is_minor, subscribed_to_newsletter, unsubscribed_at",
      )
      .not("email", "is", null)
      .order("id", { ascending: true })
      .range(from, from + 999);

    // Apply opt-in / unsubscribe gates.
    if (effective.subscribed_to_newsletter !== false) {
      q = q.is("unsubscribed_at", null);
    }
    if (effective.contact_type) {
      const list = Array.isArray(effective.contact_type)
        ? effective.contact_type
        : [effective.contact_type];
      q = q.in("contact_type", list);
    }
    if (effective.country) {
      const list = Array.isArray(effective.country)
        ? effective.country
        : [effective.country];
      q = q.in("country", list);
    }
    if (effective.source) {
      const list = Array.isArray(effective.source)
        ? effective.source
        : [effective.source];
      q = q.in("source", list);
    }
    if (effective.network_source) {
      const list = Array.isArray(effective.network_source)
        ? effective.network_source
        : [effective.network_source];
      q = q.in("network_source", list);
    }
    if (effective.excludes_minors !== false) {
      q = q.or("is_minor.is.null,is_minor.eq.false");
    }

    const { data, error } = await q;
    if (error || !data || data.length === 0) break;

    type Row = {
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      country: string | null;
      contact_type: string | null;
      is_minor: boolean | null;
      subscribed_to_newsletter: boolean | null;
      unsubscribed_at: string | null;
    };
    for (const r of data as Row[]) {
      if (!r.email) continue;
      // Defensive: if the DB doesn't have the v3 columns yet, treat as opt-in.
      if (
        r.subscribed_to_newsletter === false ||
        r.unsubscribed_at !== null
      )
        continue;
      all.push({
        contact_id: r.id,
        email: r.email,
        first_name: r.first_name,
        last_name: r.last_name,
        country: r.country,
        contact_type: r.contact_type,
      });
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  // Dedup by email (case-insensitive) — keep first occurrence.
  const seen = new Set<string>();
  return all.filter((m) => {
    const k = m.email.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const DEFAULT_AUDIENCE: AudienceFilter = ALL_OPTED_IN_FILTER;

// ─── AI content composer ───────────────────────────────────────────

const SYSTEM_PROMPTS: Record<Stream, string> = {
  general: `You are George Yachts' newsletter author. George is the founder of a family Greek yacht brokerage. The voice is: warm, knowledgeable, never salesy, signed in first person ("Warmly, George"). Audience: opted-in past charter clients, prospects, and friends of the brokerage.

Write a SHORT monthly newsletter (≤300 words). Three blocks:
  1. Personal opener — what's happening in Greek waters right now (weather, season, a small story).
  2. Fleet or trip note — one specific yacht, region, or itinerary worth mentioning by name.
  3. A gentle invitation — to reply, ask, or start planning.

Rules:
  - First-person from George
  - No emojis except in subject if natural
  - Greek touches OK ("καλωσορίσατε", "καλό μήνα") used sparingly
  - No marketing jargon, no "limited-time"
  - End: "Warmly, George"

OUTPUT a single JSON object — NO markdown fences:
{ "subject": string, "body_markdown": string }`,
  advisor: `You are George Yachts' newsletter author writing to TRAVEL ADVISORS / B2B partners. The relationship is professional peer-to-peer. They send clients to George; George needs to keep them current and equipped to sell.

Write a SHORT monthly partner update (≤350 words). Three blocks:
  1. Market snapshot — one sentence on what's booking in Greece right now.
  2. New / available inventory — one or two yachts with USP one-liners (vessel, length, region, week-rate ballpark, what makes her stand out).
  3. A useful asset — link or note: spec sheet, video walk-through, recent itinerary they can repurpose.

Rules:
  - First-person from George
  - Direct, useful — advisors are time-poor
  - No emojis
  - End: "Always reachable. Warmly, George"

OUTPUT a single JSON object — NO markdown fences:
{ "subject": string, "body_markdown": string }`,
  bespoke: `You are George Yachts' bespoke composer. Match the tone the user describes; output the same JSON shape.

OUTPUT: { "subject": string, "body_markdown": string }`,
};

export interface ComposedCampaign {
  subject: string;
  body_markdown: string;
  ai_model_used: string;
  raw_response: string;
}

export async function composeCampaign(args: {
  stream: Stream;
  brief?: string;
  context?: string;
}): Promise<ComposedCampaign> {
  const sys = SYSTEM_PROMPTS[args.stream] ?? SYSTEM_PROMPTS.bespoke;
  const userMsg = [
    args.brief
      ? `Brief from George: ${args.brief}`
      : "Compose this month's edition.",
    args.context ? `Context: ${args.context}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await aiChat(sys, userMsg, { maxTokens: 1500, temperature: 0.6 });
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) {
    return {
      subject: "Newsletter draft",
      body_markdown: raw.trim(),
      ai_model_used: process.env.AI_MODEL || "gemini-2.5-flash",
      raw_response: raw,
    };
  }
  try {
    const parsed = JSON.parse(m[0]) as { subject?: string; body_markdown?: string };
    return {
      subject: parsed.subject?.trim() || "Newsletter draft",
      body_markdown: parsed.body_markdown?.trim() || raw,
      ai_model_used: process.env.AI_MODEL || "gemini-2.5-flash",
      raw_response: raw,
    };
  } catch {
    return {
      subject: "Newsletter draft",
      body_markdown: raw.trim(),
      ai_model_used: process.env.AI_MODEL || "gemini-2.5-flash",
      raw_response: raw,
    };
  }
}

// ─── Markdown → simple HTML for the actual sent email ──────────────

export function markdownToHtml(md: string): string {
  // Intentionally tiny. We're sending plain-but-readable email; full
  // markdown libs are overkill and we only need: paragraphs, line
  // breaks, **bold**, *italic*, [link](url), bullets.
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const blocks = md.trim().split(/\n{2,}/);
  const html = blocks
    .map((block) => {
      if (/^[-*]\s+/.test(block)) {
        const items = block
          .split(/\n/)
          .map((l) => l.replace(/^[-*]\s+/, ""))
          .map((l) => `<li>${inline(escape(l))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${inline(escape(block)).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return html;

  function inline(s: string): string {
    return s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
      );
  }
}

export function unsubscribeFooter(unsubscribeUrl: string): string {
  return `\n\n---\n\nYou're receiving this because you've shared a yacht moment with us. [Unsubscribe](${unsubscribeUrl}) any time.`;
}
