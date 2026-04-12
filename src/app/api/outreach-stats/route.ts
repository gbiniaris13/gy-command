// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET() {
  const sb = createServiceClient();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now.getTime() - 7 * 86400000);

  // Count outreach contacts by time period
  const [todayRes, weekRes, totalRes, recentRes] = await Promise.all([
    sb.from("contacts").select("id", { count: "exact", head: true })
      .eq("source", "outreach_bot")
      .gte("created_at", todayStart.toISOString()),
    sb.from("contacts").select("id", { count: "exact", head: true })
      .eq("source", "outreach_bot")
      .gte("created_at", weekStart.toISOString()),
    sb.from("contacts").select("id", { count: "exact", head: true })
      .eq("source", "outreach_bot"),
    sb.from("activities").select("description, created_at, type")
      .or("type.eq.email_sent,type.eq.reply_received,type.eq.lead_captured")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const recent = (recentRes.data ?? []).map((a) => ({
    text: a.description ?? "",
    date: a.created_at ?? now.toISOString(),
    type: a.type === "reply_received" ? "reply" : a.type === "email_sent" ? "sent" : "sent",
  }));

  return NextResponse.json({
    today: { sent: todayRes.count ?? 0, opens: 0, replies: 0, bounces: 0 },
    week: { sent: weekRes.count ?? 0, opens: 0, replies: 0, bounces: 0 },
    total: { sent: totalRes.count ?? 0, opens: 0, replies: 0, bounces: 0 },
    recent,
    botActive: (totalRes.count ?? 0) > 0,
  });
}
