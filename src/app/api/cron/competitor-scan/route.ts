import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { aiChat } from "@/lib/ai";
import { observeCron } from "@/lib/cron-observer";

/**
 * Weekly competitor scan cron (Sundays at 10:00).
 *
 * 2026-04-24: This cron asks Gemini to "research" competitors, but
 * Gemini in our endpoint has NO browsing capability — it answers from
 * training data only, which means the "intel" is hallucinated when
 * it's anything more recent than the model cutoff. Disabled by default
 * to avoid false-confidence reports landing in Telegram. Flip
 * settings.competitor_scan_enabled = "true" once we wire a real
 * search API (Brave / SerpAPI / Tavily — all have free tiers).
 */
async function _observedImpl(): Promise<Response> {
  try {
    const sb = createServiceClient();
    const { data: flag } = await sb
      .from("settings")
      .select("value")
      .eq("key", "competitor_scan_enabled")
      .maybeSingle();
    if (flag?.value !== "true") {
      return NextResponse.json({
        skipped: "competitor_scan_disabled — Gemini cannot browse, reports were hallucinated. Wire real search API + flip flag to re-enable.",
      });
    }
    const competitors = [
      "CharterWorld",
      "Boatbookings",
      "YachtCharterFleet",
    ];

    const report = await aiChat(
      "You are a competitive intelligence analyst for the luxury yacht charter industry in Greece. Provide concise, actionable insights.",
      `Research these luxury yacht charter companies operating in Greece: ${competitors.join(", ")}. Find: any new yachts added to their fleet, pricing changes or promotions, notable social media activity or marketing campaigns, new partnerships or destinations. Be concise and format as a brief weekly report.`
    ) || "Unable to generate competitor report.";

    // Send to Telegram
    const telegramMessage = [
      "<b>\uD83D\uDD0D Weekly Competitor Scan</b>",
      "",
      report.substring(0, 3500),
      "",
      `<i>Generated ${new Date().toLocaleDateString("en-GB")}</i>`,
    ].join("\n");

    await sendTelegram(telegramMessage);

    return NextResponse.json({
      success: true,
      competitors,
      reportLength: report.length,
    });
  } catch (err) {
    console.error("[Competitor Scan] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<Response> {
  return observeCron("competitor-scan", _observedImpl);
}
