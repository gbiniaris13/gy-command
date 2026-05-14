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
import {
  buildVisitorIntel,
  formatVisitorIntelTelegram,
} from "@/lib/visitor-intel-engine";

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
    // 2026-05-14 — run cockpit briefing + visitor intel in parallel.
    // Visitor intel reads from the same `sessions` table written by
    // george-yachts /api/track; failures don't block the briefing
    // (legacy behaviour preserved when website tracking is empty).
    const [briefing, visitorIntel] = await Promise.all([
      buildBriefing(sb),
      buildVisitorIntel(sb).catch((e) => {
        console.error("[cockpit-briefing] visitor-intel failed:", e);
        return null;
      }),
    ]);

    // Persist as today's snapshot (so /api/cockpit/briefing serves cached)
    const today = new Date().toISOString().slice(0, 10);
    await sb
      .from("settings")
      .upsert({
        key: `cockpit_briefing_${today}`,
        value: JSON.stringify(briefing),
      });
    if (visitorIntel) {
      // PostgREST builder isn't a real Promise until awaited — wrap in
      // try/catch instead of chaining .catch() (TS rejects + same bug
      // hit the IG stories cron earlier this week).
      try {
        await sb.from("settings").upsert({
          key: `visitor_intel_${today}`,
          value: JSON.stringify(visitorIntel),
        });
      } catch (e) {
        console.error("[cockpit-briefing] visitor-intel persist failed:", e);
      }
    }

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

    const visitorBlock = visitorIntel
      ? formatVisitorIntelTelegram(visitorIntel)
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
      ...(visitorBlock ? [``, visitorBlock] : []),
      ``,
      `<b>🔪 Devil's Advocate</b>`,
      `<i>${escapeHtml(briefing.devils_advocate)}</i>`,
      // 2026-05-14 — Boss directive: drop the "Brainstorm σήμερα"
      // section. The AI prompt was returning empty `**` and George
      // doesn't want speculative questions in the morning briefing.
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
