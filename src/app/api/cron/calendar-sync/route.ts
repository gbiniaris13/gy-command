import { NextRequest, NextResponse } from "next/server";
import { calendarFetch, getSetting } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";

interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email: string }[];
}

export async function GET(request: NextRequest) {
  // Verify cron secret in production
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check if Gmail/Calendar is connected
    const refreshToken = await getSetting("gmail_refresh_token");
    if (!refreshToken) {
      return NextResponse.json({ skipped: true, reason: "Calendar not connected" });
    }

    // Fetch events from the last hour to catch new meetings
    const timeMin = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "50",
    });

    const res = await calendarFetch(`/calendars/primary/events?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: 500 });
    }

    const data = await res.json();
    const events: CalendarEvent[] = data.items ?? [];

    const sb = createServiceClient();
    let matched = 0;

    for (const event of events) {
      const attendees = event.attendees ?? [];
      if (attendees.length === 0) continue;

      // Check if any attendee email matches a CRM contact
      for (const attendee of attendees) {
        const { data: contact } = await sb
          .from("contacts")
          .select("id, pipeline_stage_id")
          .ilike("email", attendee.email.toLowerCase())
          .single();

        if (!contact) continue;

        // Find "Meeting Booked" pipeline stage
        const { data: meetingStage } = await sb
          .from("pipeline_stages")
          .select("id")
          .eq("name", "Meeting Booked")
          .single();

        if (meetingStage && contact.pipeline_stage_id !== meetingStage.id) {
          await sb
            .from("contacts")
            .update({
              pipeline_stage_id: meetingStage.id,
              last_activity_at: new Date().toISOString(),
            })
            .eq("id", contact.id);

          // Check for existing activity to avoid duplicates
          const { data: existingActivity } = await sb
            .from("activities")
            .select("id")
            .eq("contact_id", contact.id)
            .eq("type", "meeting_booked")
            .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .single();

          if (!existingActivity) {
            await sb.from("activities").insert({
              contact_id: contact.id,
              type: "meeting_booked",
              description: `Meeting scheduled: ${event.summary ?? "Calendar event"}`,
              metadata: {
                event_id: event.id,
                event_summary: event.summary,
                event_start: event.start?.dateTime ?? event.start?.date,
              },
            });
          }

          matched++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      eventsChecked: events.length,
      contactsMatched: matched,
    });
  } catch (err) {
    console.error("[Calendar Sync] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
