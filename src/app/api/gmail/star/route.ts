// /api/gmail/star — toggle Gmail star for a message AND keep CRM in sync.
//
// 2026-05-01 — promoted from "find existing contact and bump to Warm"
// to "the canonical path for a contact landing in CRM". After the
// non-starred purge, Contacts is starred-only by design — the act of
// starring an email IS the act of saying "this is a real relationship
// I want to track". So:
//
//   • If the sender already exists → flip inbox_starred=true, bump to Warm
//   • If sender doesn't exist     → create the contact with AI-inferred
//                                    contact_type, inbox_starred=true,
//                                    source='gmail_star', and stamp the
//                                    starred message id on the contact
//
// AI categorization runs on email-domain + subject + body signature.
// Conservative fallback: anything we can't classify high-confidence
// gets contact_type=null so George can fix it from the CRM.

import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import {
  parseFromHeader,
  companyFromEmail,
  parseSignature,
} from "@/lib/email-signature-parser";

type Header = { name: string; value: string };

function getHeader(headers: Header[] | undefined, name: string): string {
  if (!headers) return "";
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

function decodeBase64Url(s: string): string {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

// Recursively pull the first text/plain body from a Gmail payload
function extractTextBody(payload: {
  mimeType?: string;
  body?: { data?: string };
  parts?: Array<{
    mimeType?: string;
    body?: { data?: string };
    parts?: Array<unknown>;
  }>;
}): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    if (
      typeof part === "object" &&
      part &&
      "mimeType" in part &&
      "body" in part
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = extractTextBody(part as any);
      if (text) return text;
    }
  }
  return "";
}

const VALID_CONTACT_TYPES = [
  "CENTRAL_AGENT",
  "B2B_PARTNER",
  "BROKER_CLIENT",
  "DIRECT_CLIENT",
  "PRESS_MEDIA",
  "INDUSTRY",
  "OUTREACH_LEAD",
] as const;

type AiClassifyResult = {
  type: (typeof VALID_CONTACT_TYPES)[number] | null;
  confidence: number;
  reason: string;
};

async function aiCategorizeContact(input: {
  email: string;
  name: string | null;
  company: string | null;
  subject: string;
  signatureTitle: string | null;
  bodySnippet: string;
}): Promise<AiClassifyResult> {
  const prompt = `You are categorizing a single inbound email contact for a Greek luxury yacht charter brokerage (George Yachts). Return JSON only.

INPUT:
  Email:        ${input.email}
  Name:         ${input.name ?? "(unknown)"}
  Company:      ${input.company ?? "(personal email or unknown)"}
  Subject:      ${input.subject}
  Title (sig):  ${input.signatureTitle ?? "(none parsed)"}
  Body snippet: ${input.bodySnippet.slice(0, 300)}

CATEGORIES (pick exactly one):
  CENTRAL_AGENT    — yacht broker representing one or more vessels (Burgess, Edmiston, Camper & Nicholsons, IYC, Fraser, Northrop & Johnson, etc). Speaks of "my fleet", "my listings", "broker of M/Y X".
  B2B_PARTNER      — luxury travel/concierge/hotel/destination platform sending or accepting referrals. Travel agencies that PASS clients to us count here.
  BROKER_CLIENT    — a retail yacht broker booking on behalf of THEIR client. Distinct from CENTRAL_AGENT (who owns inventory).
  DIRECT_CLIENT    — end customer chartering for themselves (private email common, talks about a specific trip/dates/family).
  PRESS_MEDIA      — journalist, magazine, blog, podcast, content creator.
  INDUSTRY         — captain, crew agency, supplier, marina, port authority, shipyard.
  OUTREACH_LEAD    — fallback when nothing else fits.

RULES:
  - Personal-email domains (gmail/yahoo/hotmail/outlook/icloud) → likely DIRECT_CLIENT unless the body strongly suggests trade.
  - Domains like burgessyachts.com / edmiston.com / camperandnicholsons.com / fraseryachts.com / iyc.com → CENTRAL_AGENT.
  - Domains like virtuoso.com / fora.travel / altour.com / protravelinc.com / mohg.com → B2B_PARTNER.
  - "broker representing" / "my client" → BROKER_CLIENT.
  - Press hints: byline, "writing a piece", magazine name → PRESS_MEDIA.

Return strictly:
  {"type":"<ONE_OF_THE_7>","confidence":0.0-1.0,"reason":"<one short sentence>"}`;

  try {
    const raw = await aiChat(
      "You are a fast, terse classifier. Return JSON only, no markdown.",
      prompt,
      { maxTokens: 200, temperature: 0.2 },
    );
    // Strip code-fences if AI wrapped them anyway
    const cleaned = raw
      .replace(/```json\s*/gi, "")
      .replace(/```\s*$/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (
      typeof parsed.type === "string" &&
      VALID_CONTACT_TYPES.includes(parsed.type)
    ) {
      return {
        type: parsed.type,
        confidence: Number(parsed.confidence) || 0.5,
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
      };
    }
  } catch (e) {
    console.error("[Gmail Star] AI categorize error:", e);
  }
  return { type: null, confidence: 0, reason: "ai-classify-failed" };
}

export async function POST(request: NextRequest) {
  try {
    const { messageId, starred } = await request.json();

    if (!messageId || typeof starred !== "boolean") {
      return NextResponse.json(
        { error: "Missing required fields: messageId, starred (boolean)" },
        { status: 400 },
      );
    }

    // 1. Toggle the Gmail star itself.
    const body = starred
      ? { addLabelIds: ["STARRED"], removeLabelIds: [] }
      : { addLabelIds: [], removeLabelIds: ["STARRED"] };

    const res = await gmailFetch(`/messages/${messageId}/modify`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    // 2. CRM-side reflection. Only on STAR (un-star is handled by the
    //    nightly inbox-star-sync cron — it would be premature to wipe
    //    inbox_starred=false here in case the user mis-clicks).
    let crmAction: string | null = null;
    let crmContactId: string | null = null;

    if (starred) {
      try {
        // Pull full message so we have headers + body for AI classify.
        const msgRes = await gmailFetch(
          `/messages/${messageId}?format=full`,
        );
        if (msgRes.ok) {
          const msg = (await msgRes.json()) as {
            id: string;
            threadId?: string;
            payload?: {
              headers?: Header[];
              mimeType?: string;
              body?: { data?: string };
              parts?: Array<unknown>;
            };
          };
          const headers = msg.payload?.headers ?? [];
          const fromHeader = getHeader(headers, "From");
          const subject = getHeader(headers, "Subject");
          const { name: parsedName, email: senderEmail } =
            parseFromHeader(fromHeader);

          if (senderEmail) {
            const sb = createServiceClient();

            // Look for existing contact (case-insensitive)
            const { data: contact } = await sb
              .from("contacts")
              .select("id, pipeline_stage_id, inbox_starred")
              .ilike("email", senderEmail)
              .maybeSingle();

            if (contact) {
              // Existing — set starred + promote to Warm
              const { data: warmStage } = await sb
                .from("pipeline_stages")
                .select("id")
                .eq("name", "Warm")
                .maybeSingle();

              await sb
                .from("contacts")
                .update({
                  inbox_starred: true,
                  inbox_starred_at: new Date().toISOString(),
                  inbox_starred_thread_id: msg.threadId ?? null,
                  pipeline_stage_id:
                    warmStage?.id ?? contact.pipeline_stage_id,
                  last_activity_at: new Date().toISOString(),
                })
                .eq("id", contact.id);

              await sb.from("activities").insert({
                contact_id: contact.id,
                type: "email_starred",
                description: "Email starred in Gmail",
                metadata: { message_id: messageId },
              });

              crmAction = "existing-contact-promoted";
              crmContactId = contact.id;
            } else {
              // New contact — AI categorize and create
              const bodyText = extractTextBody(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                msg.payload as any,
              );
              const sig = parseSignature(bodyText);
              const company =
                sig.company ?? companyFromEmail(senderEmail) ?? null;

              const ai = await aiCategorizeContact({
                email: senderEmail,
                name: parsedName ?? sig.name,
                company,
                subject,
                signatureTitle: sig.title,
                bodySnippet: bodyText,
              });

              // Default pipeline stage = New (or first)
              const { data: defaultStage } = await sb
                .from("pipeline_stages")
                .select("id, name")
                .order("position", { ascending: true })
                .limit(1)
                .maybeSingle();

              const [firstName, ...lastParts] = (
                parsedName ??
                sig.name ??
                ""
              ).split(/\s+/);

              const { data: newContact } = await sb
                .from("contacts")
                .insert({
                  first_name: firstName || null,
                  last_name: lastParts.join(" ") || null,
                  email: senderEmail,
                  company,
                  contact_type: ai.type,
                  source: "gmail_star",
                  pipeline_stage_id: defaultStage?.id ?? null,
                  inbox_starred: true,
                  inbox_starred_at: new Date().toISOString(),
                  inbox_starred_thread_id: msg.threadId ?? null,
                  last_activity_at: new Date().toISOString(),
                  notes:
                    ai.reason && ai.confidence >= 0.5
                      ? `Auto-categorized as ${ai.type} (${Math.round(ai.confidence * 100)}% confidence): ${ai.reason}`
                      : null,
                })
                .select("id")
                .maybeSingle();

              if (newContact) {
                await sb.from("activities").insert({
                  contact_id: newContact.id,
                  type: "email_starred",
                  description: "Created from Gmail star + AI categorize",
                  metadata: {
                    message_id: messageId,
                    ai_type: ai.type,
                    ai_confidence: ai.confidence,
                    ai_reason: ai.reason,
                  },
                });
                crmAction = `created-${ai.type ?? "uncategorized"}`;
                crmContactId = newContact.id;
              }
            }
          }
        }
      } catch (matchErr) {
        console.error("[Gmail Star] CRM sync error:", matchErr);
        // Non-fatal — Gmail star was already toggled.
      }
    }

    return NextResponse.json({
      success: true,
      starred,
      crm_action: crmAction,
      crm_contact_id: crmContactId,
    });
  } catch (err) {
    console.error("[Gmail] Star error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
