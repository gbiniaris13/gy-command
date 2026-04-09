import { NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";
import { aiChat } from "@/lib/ai";

/**
 * Weekly competitor scan cron (Sundays at 10:00).
 * Uses Anthropic API to generate a competitor intelligence report
 * and sends it to Telegram.
 */
export async function GET() {
  try {
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
