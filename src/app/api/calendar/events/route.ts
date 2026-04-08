import { NextRequest, NextResponse } from "next/server";
import { calendarFetch } from "@/lib/google-api";

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  colorId?: string;
  htmlLink?: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const timeMin =
    searchParams.get("timeMin") ?? new Date().toISOString();
  const timeMax =
    searchParams.get("timeMax") ??
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
    });

    const res = await calendarFetch(`/calendars/primary/events?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const data = await res.json();
    const events = (data.items ?? []).map((evt: CalendarEvent) => ({
      id: evt.id,
      summary: evt.summary ?? "(No title)",
      description: evt.description ?? "",
      start: evt.start?.dateTime ?? evt.start?.date ?? "",
      end: evt.end?.dateTime ?? evt.end?.date ?? "",
      attendees: (evt.attendees ?? []).map((a) => ({
        email: a.email,
        name: a.displayName ?? "",
        status: a.responseStatus ?? "needsAction",
      })),
      colorId: evt.colorId ?? "",
      htmlLink: evt.htmlLink ?? "",
    }));

    return NextResponse.json({ events });
  } catch (err) {
    console.error("[Calendar] List events error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
