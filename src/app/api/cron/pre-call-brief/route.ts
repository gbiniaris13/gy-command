import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { calendarFetch } from "@/lib/google-api";
import { sendTelegram } from "@/lib/telegram";
import { getFlagFromCountry } from "@/lib/flags";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  country: string | null;
  city: string | null;
  notes: string | null;
  pipeline_stage: { name: string } | { name: string }[] | null;
}

async function generateBrief(
  name: string,
  company: string | null,
  country: string | null
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Research this person for a pre-call brief:
Name: ${name}
Company: ${company ?? "Unknown"}
Country: ${country ?? "Unknown"}
Role: (infer from context)

Provide:
1. What their company does (2 lines)
2. What they might need from a yacht charter brokerage (2 lines)
3. 3 good opening questions for the meeting

Be concise. No fluff.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error: ${res.status} ${text}`);
  }

  const data = await res.json();
  const block = data.content?.[0];
  return block?.type === "text" ? block.text : "Brief generation failed.";
}

/**
 * Hourly cron: generate pre-call briefs for upcoming meetings.
 * Looks 2 hours ahead on Google Calendar.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const supabase = createServiceClient();
    const now = new Date();
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // Fetch calendar events for the next 2 hours
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: twoHoursLater.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
    });

    const calRes = await calendarFetch(
      `/calendars/primary/events?${params.toString()}`
    );

    if (!calRes.ok) {
      const text = await calRes.text();
      console.error("[Pre-Call Brief] Calendar API error:", text);
      return NextResponse.json(
        { error: "Calendar API error", details: text },
        { status: 500 }
      );
    }

    const calData = await calRes.json();
    const events = (calData.items ?? []) as CalendarEvent[];

    let briefsGenerated = 0;

    for (const event of events) {
      const attendees = event.attendees ?? [];
      if (attendees.length === 0) continue;

      const eventStart = event.start?.dateTime ?? event.start?.date ?? "";
      const startDate = new Date(eventStart);
      const minutesUntil = Math.round(
        (startDate.getTime() - now.getTime()) / 60000
      );

      for (const attendee of attendees) {
        if (!attendee.email) continue;
        // Skip the calendar owner's own email
        if (attendee.email.includes("georgeyachts")) continue;

        // Search CRM contacts by attendee email
        const { data: contacts } = await supabase
          .from("contacts")
          .select(
            "id, first_name, last_name, email, company, country, city, notes, pipeline_stage:pipeline_stages(name)"
          )
          .eq("email", attendee.email)
          .limit(1);

        if (!contacts || contacts.length === 0) continue;

        const contact = contacts[0] as ContactRow;
        const name =
          [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
          attendee.displayName ||
          "Unknown";

        // Check if we already generated a brief for this contact today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: existingBriefs } = await supabase
          .from("activities")
          .select("id")
          .eq("contact_id", contact.id)
          .eq("type", "meeting")
          .gte("created_at", todayStart.toISOString())
          .limit(1);

        if (existingBriefs && existingBriefs.length > 0) continue;

        // Generate AI brief
        const brief = await generateBrief(
          name,
          contact.company,
          contact.country
        );

        // Save as activity
        await supabase.from("activities").insert({
          contact_id: contact.id,
          type: "meeting",
          description: `Pre-call brief for "${event.summary ?? "Meeting"}"`,
          metadata: {
            brief,
            event_id: event.id,
            event_summary: event.summary,
            event_start: eventStart,
            generated_by: "cron",
          },
        });

        // Update last_activity_at
        await supabase
          .from("contacts")
          .update({ last_activity_at: new Date().toISOString() })
          .eq("id", contact.id);

        // Get the flag
        const flag = getFlagFromCountry(contact.country);

        // Send to Telegram
        const stageData = contact.pipeline_stage;
        const stageName = Array.isArray(stageData)
          ? stageData[0]?.name ?? "?"
          : (stageData as { name: string } | null)?.name ?? "?";

        const telegramMsg = [
          `<b>PRE-CALL BRIEF</b> -- Meeting in ${minutesUntil}min`,
          `<b>Person:</b> ${name}`,
          `<b>Company:</b> ${contact.company ?? "Unknown"}`,
          `<b>Country:</b> ${contact.country ?? "Unknown"} ${flag}`,
          `<b>Stage:</b> ${stageName}`,
          "",
          brief,
          "",
          `<a href="https://command.georgeyachts.com/dashboard/contacts/${contact.id}">View in CRM</a>`,
        ].join("\n");

        await sendTelegram(telegramMsg);
        briefsGenerated++;
      }
    }

    return NextResponse.json({
      ok: true,
      events_checked: events.length,
      briefs_generated: briefsGenerated,
    });
  } catch (err) {
    console.error("[Pre-Call Brief] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
