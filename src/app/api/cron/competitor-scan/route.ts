import { NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

/**
 * Weekly competitor scan cron (Sundays at 10:00).
 * Uses Anthropic API to generate a competitor intelligence report
 * and sends it to Telegram.
 */
export async function GET() {
  try {
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const competitors = [
      "CharterWorld",
      "Boatbookings",
      "YachtCharterFleet",
    ];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system:
          "You are a competitive intelligence analyst for the luxury yacht charter industry in Greece. Provide concise, actionable insights.",
        messages: [
          {
            role: "user",
            content: `Research these luxury yacht charter companies operating in Greece: ${competitors.join(", ")}. Find: any new yachts added to their fleet, pricing changes or promotions, notable social media activity or marketing campaigns, new partnerships or destinations. Be concise and format as a brief weekly report.`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[Competitor Scan] Anthropic error:", res.status, text);
      return NextResponse.json(
        { error: "Failed to generate report" },
        { status: 500 }
      );
    }

    const data = await res.json();
    const textBlock = data.content?.find(
      (b: { type: string }) => b.type === "text"
    );
    const report =
      textBlock?.text ?? "Unable to generate competitor report.";

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
