// Pillar 5 — weekly digest of top 10 warming + top 10 cooling
// contacts. Sent via Telegram Sunday 09:00 Athens.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Row {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  health_score: number | null;
  health_score_trend: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function name(r: Row): string {
  return (
    `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() ||
    r.email ||
    "(contact)"
  );
}

export async function GET() {
  try {
    const sb = createServiceClient();

    const { data: warming } = await sb
      .from("contacts")
      .select(
        "id, first_name, last_name, email, health_score, health_score_trend",
      )
      .eq("health_score_trend", "up")
      .not("health_score", "is", null)
      .order("health_score", { ascending: false })
      .limit(10);

    const { data: cooling } = await sb
      .from("contacts")
      .select(
        "id, first_name, last_name, email, health_score, health_score_trend",
      )
      .eq("health_score_trend", "down")
      .not("health_score", "is", null)
      .order("health_score", { ascending: true })
      .limit(10);

    const lines: string[] = ["🌡️ <b>Weekly relationship health digest</b>", ""];
    if ((warming?.length ?? 0) > 0) {
      lines.push("<b>📈 Warming up — invest here</b>");
      for (const r of warming as Row[]) {
        lines.push(`· ${escapeHtml(name(r))} — ${r.health_score}/100`);
      }
      lines.push("");
    }
    if ((cooling?.length ?? 0) > 0) {
      lines.push("<b>📉 Cooling — soft-ghost watch</b>");
      for (const r of cooling as Row[]) {
        lines.push(`· ${escapeHtml(name(r))} — ${r.health_score}/100`);
      }
      lines.push("");
    }
    if ((warming?.length ?? 0) === 0 && (cooling?.length ?? 0) === 0) {
      lines.push("<i>All relationships steady this week.</i>");
    }
    lines.push(
      `<a href="https://command.georgeyachts.com">→ Open cockpit</a>`,
    );

    await sendTelegram(lines.join("\n")).catch(() => {});

    return NextResponse.json({
      ok: true,
      warming: warming?.length ?? 0,
      cooling: cooling?.length ?? 0,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
