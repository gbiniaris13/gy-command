import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

/**
 * GET — Generate a luxury yacht charter proposal for a contact.
 * Uses Anthropic API to create professional proposal text.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { id } = await params;
    const supabase = createServiceClient();

    // Fetch contact data
    const { data: contact, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !contact) {
      return NextResponse.json(
        { error: "Contact not found" },
        { status: 404 }
      );
    }

    const fullName =
      [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
      "Valued Client";
    const company = contact.company || "their company";
    const vessel = contact.charter_vessel || "a luxury motor yacht";
    const startDate = contact.charter_start_date
      ? new Date(contact.charter_start_date).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "TBD";
    const endDate = contact.charter_end_date
      ? new Date(contact.charter_end_date).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "TBD";
    const guests = contact.charter_guests ?? "TBD";
    const embarkation = contact.charter_embarkation || "Athens";
    const disembarkation = contact.charter_disembarkation || "Athens";
    const fee = contact.charter_fee
      ? `EUR ${Number(contact.charter_fee).toLocaleString()}`
      : "upon request";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system:
          "You are a luxury yacht charter proposal writer for George Yachts, a premium charter brokerage based in Greece. Write in professional, elegant language befitting the luxury yachting industry. Use HTML formatting with h2, h3, p, ul/li tags. Do not use markdown.",
        messages: [
          {
            role: "user",
            content: `Generate a luxury yacht charter proposal for ${fullName} from ${company}.
Vessel: ${vessel}
Dates: ${startDate} to ${endDate}
Guests: ${guests}
Embarkation: ${embarkation}
Disembarkation: ${disembarkation}
Charter Fee: ${fee}

Include: yacht description, itinerary highlights through the Greek islands, what's included (crew, fuel, water toys, gourmet cuisine), pricing summary. Professional tone, luxury feel. Sign off as George P. Biniaris, George Yachts.`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[Proposal] Anthropic error:", res.status, text);
      return NextResponse.json(
        { error: "Failed to generate proposal" },
        { status: 500 }
      );
    }

    const data = await res.json();
    const textBlock = data.content?.find(
      (b: { type: string }) => b.type === "text"
    );
    const html = textBlock?.text ?? "<p>Unable to generate proposal.</p>";

    // Log activity
    await supabase.from("activities").insert({
      contact_id: id,
      type: "proposal_sent",
      description: `Charter proposal generated for ${fullName}`,
    });

    return NextResponse.json({ html });
  } catch (err) {
    console.error("[Proposal] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
