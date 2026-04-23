/**
 * Send a message to the configured Telegram chat via Bot API.
 *
 * Hardened 2026-04-23 after the gmail-poll 05:48 incident where ~40
 * HOT/WARM classifications fired in a single tick and hit Telegram's
 * per-chat rate limit (≈1 msg/sec per chat, ≈30/sec global), producing
 * the runtime-log 429 storm.
 *
 * Two layers of protection:
 *   1. **Global serialization** — a module-scoped promise chain so no
 *      two sendTelegram() calls ever run concurrently. We also space
 *      sends by 1100ms minimum to stay inside the 1/sec per-chat cap.
 *   2. **429 retry with honored retry_after** — on 429, we read the
 *      Telegram response's retry_after field, sleep exactly that long
 *      (+250ms jitter), then retry once. No infinite loops.
 *
 * Return value unchanged: true on success, false on any failure.
 */
const MIN_GAP_MS = 1100;
let chain: Promise<unknown> = Promise.resolve();
let lastSendAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendOnce(
  token: string,
  chatId: string,
  message: string,
  disablePreview: boolean,
): Promise<{ ok: boolean; retryAfter?: number; status: number; body: string }> {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        ...(disablePreview && { disable_web_page_preview: true }),
      }),
    },
  );
  const body = await res.text();
  if (res.ok) return { ok: true, status: res.status, body };
  let retryAfter: number | undefined;
  if (res.status === 429) {
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.parameters?.retry_after === "number") {
        retryAfter = parsed.parameters.retry_after;
      }
    } catch {
      /* fall through */
    }
  }
  return { ok: false, status: res.status, body, retryAfter };
}

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

  const disablePreview = !!opts?.disablePreview;

  const task = async (): Promise<boolean> => {
    // Respect min-gap since last send (serialized via chain → safe).
    const gap = Date.now() - lastSendAt;
    if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);

    try {
      let r = await sendOnce(token, chatId, message, disablePreview);
      if (!r.ok && r.status === 429 && r.retryAfter != null) {
        const wait = Math.min(r.retryAfter * 1000 + 250, 30_000);
        console.warn(`[Telegram] 429 — sleeping ${wait}ms then retrying`);
        await sleep(wait);
        r = await sendOnce(token, chatId, message, disablePreview);
      }
      lastSendAt = Date.now();
      if (!r.ok) {
        console.error("[Telegram] Send failed:", r.status, r.body.slice(0, 200));
        return false;
      }
      return true;
    } catch (err) {
      lastSendAt = Date.now();
      console.error("[Telegram] Network error:", err);
      return false;
    }
  };

  // Serialize all sends module-wide.
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}
