import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch, calendarFetch } from "@/lib/google-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const results = await Promise.allSettled([
    getHotLeads(),
    getEmailsSentToday(),
    getMeetingsToday(),
    getNewReplies(),
  ]);

  return NextResponse.json({
    hotLeads: results[0].status === "fulfilled" ? results[0].value : 0,
    emailsSent: results[1].status === "fulfilled" ? results[1].value : 0,
    meetingsToday: results[2].status === "fulfilled" ? results[2].value : 0,
    newReplies: results[3].status === "fulfilled" ? results[3].value : 0,
  });
}

// ─── Hot leads from CRM ─────────────────────────────────────────────────────

async function getHotLeads(): Promise<number> {
  const sb = createServiceClient();
  const { count } = await sb
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq(
      "pipeline_stage_id",
      (
        await sb
          .from("pipeline_stages")
          .select("id")
          .eq("name", "Hot")
          .single()
      ).data?.id ?? ""
    );
  return count ?? 0;
}

// ─── Emails sent today via Gmail ────────────────────────────────────────────

async function getEmailsSentToday(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const epoch = Math.floor(today.getTime() / 1000);
  const q = `in:sent after:${epoch}`;

  const res = await gmailFetch(
    `/messages?q=${encodeURIComponent(q)}&maxResults=1`
  );
  if (!res.ok) return 0;
  const data = await res.json();
  return data.resultSizeEstimate ?? 0;
}

// ─── Meetings today via Calendar ────────────────────────────────────────────

async function getMeetingsToday(): Promise<number> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const params = new URLSearchParams({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: "true",
    maxResults: "50",
  });

  const res = await calendarFetch(
    `/calendars/primary/events?${params.toString()}`
  );
  if (!res.ok) return 0;
  const data = await res.json();
  return (data.items ?? []).length;
}

// ─── New replies (unread inbox) via Gmail ────────────────────────────────────

async function getNewReplies(): Promise<number> {
  const q = "in:inbox is:unread";
  const res = await gmailFetch(
    `/messages?q=${encodeURIComponent(q)}&maxResults=1`
  );
  if (!res.ok) return 0;
  const data = await res.json();
  return data.resultSizeEstimate ?? 0;
}
