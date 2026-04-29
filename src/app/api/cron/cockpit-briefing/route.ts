// Daily cockpit briefing cron — fires 06:00 Athens (03:00 UTC).
//
// Builds the day's CockpitBriefing, persists it, and pushes a
// formatted summary to Telegram so George wakes up to a single
// actionable message — not 14 dashboard tabs.
//
// The dashboard hits the same cached briefing, so by the time George
// opens https://gy-command.vercel.app/dashboard at 09:00, the data is
// already warm from this 06:00 run.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { buildBriefing } from "@/lib/cockpit-engine";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";

export const runtime = "nodejs";
export const maxDuration = 120;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function priorityEmoji(p: string): string {
  if (p === "critical") return "🔴";
  if (p === "high") return "🟠";
  if (p === "medium") return "🟡";
  return "⚪";
}

async function _observedImpl(): Promise<Response> {
  try {
    const sb = createServiceClient();
    const briefing = await buildBriefing(sb);

    // Persist as today's snapshot (so /api/cockpit/briefing serves cached)
    const today = new Date().toISOString().slice(0, 10);
    await sb
      .from("settings")
      .upsert({
        key: `cockpit_briefing_${today}`,
        value: JSON.stringify(briefing),
      });

    // Format Telegram message — concise, actionable
    const actionsBlock = briefing.actions.length
      ? briefing.actions
          .map(
            (a, i) =>
              `${priorityEmoji(a.priority)} <b>${i + 1}. ${escapeHtml(a.title)}</b>\n   <i>${escapeHtml(a.reason)}</i>`,
          )
          .join("\n\n")
      : "<i>No urgent actions today — focus on outbound.</i>";

    const oppsBlock = briefing.opportunities.length
      ? briefing.opportunities
          .map((o) => `· ${escapeHtml(o.title)}`)
          .join("\n")
      : "";

    const msg = [
      `☀️ <b>${escapeHtml(briefing.greeting)}</b>`,
      ``,
      `<b>📍 Σήμερα κάνε αυτά:</b>`,
      ``,
      actionsBlock,
      ``,
      `<b>💰 Pipeline pulse</b>`,
      `Active: <b>€${briefing.pulse.total_pipeline_value_eur.toLocaleString()}</b> · Commission: <b>€${briefing.pulse.total_commission_upside_eur.toLocaleString()}</b>`,
      `Deals: ${briefing.pulse.active_deals_count} · Hot: ${briefing.pulse.hot_leads_count} · Stale warm: ${briefing.pulse.stale_warm_leads_count}`,
      ...(oppsBlock ? [``, `<b>💡 Opportunities</b>`, oppsBlock] : []),
      ``,
      `<b>🔪 Devil's Advocate</b>`,
      `<i>${escapeHtml(briefing.devils_advocate)}</i>`,
      ``,
      `<b>🧠 Brainstorm sήμερα:</b>`,
      `<i>${escapeHtml(briefing.brainstorm_prompt)}</i>`,
      ``,
      `<a href="https://gy-command.vercel.app/dashboard">→ Ανοίξε Cockpit</a>`,
    ].join("\n");

    await sendTelegram(msg).catch((e) => {
      console.error("[cockpit-briefing] Telegram send failed:", e);
    });

    return NextResponse.json({
      ok: true,
      actions_count: briefing.actions.length,
      opportunities_count: briefing.opportunities.length,
      pipeline_value: briefing.pulse.total_pipeline_value_eur,
    });
  } catch (e: any) {
    console.error("[cockpit-briefing] FAILED:", e);
    await sendTelegram(
      `⚠️ <b>Cockpit briefing failed</b>\n<code>${(e?.message ?? "unknown").slice(0, 300)}</code>`,
    ).catch(() => {});
    return NextResponse.json(
      { error: e?.message ?? "unknown" },
      { status: 500 },
    );
  }
}

export async function GET(): Promise<Response> {
  return observeCron("cockpit-briefing", _observedImpl);
}
