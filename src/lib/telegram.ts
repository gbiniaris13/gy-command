/**
 * Send a message to the configured Telegram chat via Bot API.
 * Falls back to hardcoded credentials if env vars are missing.
 */
export async function sendTelegram(
  message: string,
  opts?: { disablePreview?: boolean },
): Promise<boolean> {
  const token =
    process.env.TELEGRAM_BOT_TOKEN ||
    "8773911706:AAFixtS_3kQLWB4G3FL9vMt4v5AKh9sNtqo";
  const chatId = process.env.TELEGRAM_CHAT_ID || "8478263770";

  if (!token || !chatId) {
    console.warn("[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return false;
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
          ...(opts?.disablePreview && { disable_web_page_preview: true }),
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error("[Telegram] Send failed:", res.status, body);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[Telegram] Network error:", err);
    return false;
  }
}
