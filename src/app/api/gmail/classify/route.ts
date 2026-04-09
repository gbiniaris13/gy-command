import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { aiChat } from "@/lib/ai";

interface ClassifyRequest {
  messageId: string;
  from: string;
  subject: string;
  body: string;
}

interface ClassifyResult {
  classification: "HOT" | "WARM" | "COLD" | "NEUTRAL";
  reason: string;
  suggested_response: string;
}

const CLASSIFICATION_PROMPT = `You are an AI assistant for George Yachts, a luxury yacht brokerage. Classify the following email reply based on the sender's level of interest in partnership or yacht services.

CLASSIFICATION RULES:
- HOT: Sender explicitly wants to proceed, book a call, sign a partnership, or make a purchase decision. Shows strong urgency.
- WARM: Sender is interested, asking questions, requesting more info, or engaging positively but not yet committing.
- COLD: Sender is politely declining, asking to be removed, saying not interested, or giving a vague non-committal response.
- NEUTRAL: Auto-replies, out-of-office messages, newsletters, or messages unrelated to business.

Respond ONLY with valid JSON in this exact format:
{
  "classification": "HOT" | "WARM" | "COLD" | "NEUTRAL",
  "reason": "Brief explanation of why this classification was chosen",
  "suggested_response": "A short suggested reply George could send back"
}

EMAIL:
From: {FROM}
Subject: {SUBJECT}
Body:
{BODY}`;

async function classifyWithAI(email: ClassifyRequest): Promise<ClassifyResult> {
  const prompt = CLASSIFICATION_PROMPT
    .replace("{FROM}", email.from)
    .replace("{SUBJECT}", email.subject)
    .replace("{BODY}", email.body.slice(0, 3000)); // Limit body length

  const content = await aiChat(
    "You classify emails for a luxury yacht brokerage. Respond only with valid JSON.",
    prompt
  );

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse AI response as JSON");
  }

  return JSON.parse(jsonMatch[0]) as ClassifyResult;
}

export async function POST(request: NextRequest) {
  try {
    const { messageId, from, subject, body }: ClassifyRequest =
      await request.json();

    if (!messageId || !from) {
      return NextResponse.json(
        { error: "Missing required fields: messageId, from" },
        { status: 400 }
      );
    }

    const sb = createServiceClient();

    // Check if already classified
    const { data: existing } = await sb
      .from("email_classifications")
      .select("*")
      .eq("message_id", messageId)
      .single();

    if (existing) {
      return NextResponse.json(existing);
    }

    // Classify with AI
    const result = await classifyWithAI({ messageId, from, subject, body });

    // Extract sender email
    const emailMatch = from.match(/<([^>]+)>/) ?? [null, from];
    const senderEmail = (emailMatch[1] ?? "").toLowerCase().trim();

    // Try to find matching contact
    let contactId: string | null = null;
    if (senderEmail) {
      const { data: contact } = await sb
        .from("contacts")
        .select("id")
        .ilike("email", senderEmail)
        .single();
      contactId = contact?.id ?? null;
    }

    // Save classification
    await sb.from("email_classifications").upsert({
      message_id: messageId,
      contact_id: contactId,
      classification: result.classification,
      reason: result.reason,
      suggested_response: result.suggested_response,
    });

    // Send Telegram alert for HOT/WARM leads
    if (result.classification === "HOT" || result.classification === "WARM") {
      const emoji = result.classification === "HOT" ? "🔴" : "🟡";
      const senderName = from.replace(/<.*>/, "").trim() || senderEmail;
      await sendTelegram(
        `${emoji} <b>${result.classification} Lead Reply</b>\n` +
          `From: ${senderName}\n` +
          `Subject: ${subject}\n` +
          `Reason: ${result.reason}`
      );
    }

    // Update contact pipeline stage if matched
    if (contactId && (result.classification === "HOT" || result.classification === "WARM")) {
      const stageName = result.classification === "HOT" ? "Hot" : "Warm";
      const { data: stage } = await sb
        .from("pipeline_stages")
        .select("id")
        .eq("name", stageName)
        .single();

      if (stage) {
        await sb
          .from("contacts")
          .update({
            pipeline_stage_id: stage.id,
            last_activity_at: new Date().toISOString(),
          })
          .eq("id", contactId);

        await sb.from("activities").insert({
          contact_id: contactId,
          type: "ai_classification",
          description: `Email classified as ${result.classification}: ${result.reason}`,
          metadata: {
            message_id: messageId,
            classification: result.classification,
          },
        });
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[Gmail Classify] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
