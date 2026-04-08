import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  try {
    const { messageId, starred } = await request.json();

    if (!messageId || typeof starred !== "boolean") {
      return NextResponse.json(
        { error: "Missing required fields: messageId, starred (boolean)" },
        { status: 400 }
      );
    }

    // Modify labels via Gmail API
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

    // If starring, try to match sender to CRM contact and move to Warm
    if (starred) {
      try {
        // Get the message to find sender email
        const msgRes = await gmailFetch(
          `/messages/${messageId}?format=metadata&metadataHeaders=From`
        );
        if (msgRes.ok) {
          const msg = await msgRes.json();
          const fromHeader: string =
            msg.payload?.headers?.find(
              (h: { name: string }) => h.name.toLowerCase() === "from"
            )?.value ?? "";

          // Extract email from "Name <email>" format
          const emailMatch = fromHeader.match(/<([^>]+)>/) ?? [null, fromHeader];
          const senderEmail = (emailMatch[1] ?? "").toLowerCase().trim();

          if (senderEmail) {
            const sb = createServiceClient();

            // Find matching contact
            const { data: contact } = await sb
              .from("contacts")
              .select("id, pipeline_stage_id")
              .ilike("email", senderEmail)
              .single();

            if (contact) {
              // Find "Warm" pipeline stage
              const { data: warmStage } = await sb
                .from("pipeline_stages")
                .select("id")
                .eq("name", "Warm")
                .single();

              if (warmStage) {
                await sb
                  .from("contacts")
                  .update({
                    pipeline_stage_id: warmStage.id,
                    last_activity_at: new Date().toISOString(),
                  })
                  .eq("id", contact.id);
              }

              // Add activity
              await sb.from("activities").insert({
                contact_id: contact.id,
                type: "email_starred",
                description: "Email starred in Gmail",
                metadata: { message_id: messageId },
              });
            }
          }
        }
      } catch (matchErr) {
        console.error("[Gmail Star] Contact match error:", matchErr);
        // Non-fatal — star was already toggled
      }
    }

    return NextResponse.json({ success: true, starred });
  } catch (err) {
    console.error("[Gmail] Star error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
