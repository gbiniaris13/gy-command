/**
 * Deterministic auto-reply / out-of-office detection.
 *
 * Runs BEFORE any AI classification so that follow-up sequences are never
 * stopped by an automatic response. If this returns true, the caller should
 * treat the email as "no real reply yet" and keep the sequence active.
 *
 * Detection order (fastest → slowest):
 *   1. RFC-standard auto-response headers
 *   2. Subject-line phrases (most auto-replies give themselves away here)
 *   3. Body phrases (fallback for poorly-configured OOO systems)
 */

const AUTO_REPLY_HEADERS = [
  "auto-submitted",
  "x-autoreply",
  "x-autorespond",
  "x-autoresponder",
  "x-auto-response-suppress",
  "precedence", // "auto_reply" / "bulk" / "list"
];

const AUTO_REPLY_SUBJECT_PATTERNS = [
  /\bauto(?:matic)?[-\s]?reply\b/i,
  /\bauto[-\s]?responder\b/i,
  /\bout\s+of\s+(?:the\s+)?office\b/i,
  /\bo{2,}o\b/i, // "OOO"
  /\bi\s+am\s+(?:currently\s+)?out\b/i,
  /\bi['`’]?m\s+(?:currently\s+)?out\b/i,
  /\baway\s+from\s+(?:the\s+)?office\b/i,
  /\bon\s+(?:vacation|holiday|leave|annual\s+leave)\b/i,
  /\bcurrently\s+unavailable\b/i,
  /\bwill\s+be\s+back\b/i,
  /\blimited\s+(?:access|connectivity)\b/i,
  /\bdelayed\s+(?:response|reply)\b/i,
  /\bautomatisch(e)?\s+antwort\b/i, // German
  /\brisposta\s+automatica\b/i, // Italian
  /\bauto[-\s]?respuesta\b/i, // Spanish
];

const AUTO_REPLY_BODY_PATTERNS = [
  /\bi\s+am\s+(?:currently\s+)?(?:out\s+of\s+(?:the\s+)?office|on\s+(?:vacation|holiday|annual\s+leave))\b/i,
  /\bthank\s+you\s+for\s+your\s+(?:email|message)[^.]*(?:i['`’]?m\s+(?:currently\s+)?(?:out|away)|out\s+of\s+(?:the\s+)?office)/i,
  /\bi\s+will\s+(?:be\s+)?(?:back|return(?:ing)?)\s+on\b/i,
  /\bi\s+will\s+respond\s+(?:to\s+your\s+email\s+)?(?:when|upon|as\s+soon\s+as)\b/i,
  /\bfor\s+urgent\s+matters[,.]?\s+(?:please\s+)?contact\b/i,
  /\bthis\s+is\s+an\s+automated\s+(?:reply|response|message)\b/i,
];

export interface AutoReplyCheck {
  isAutoReply: boolean;
  reason: string;
}

/**
 * Check if an email is an auto-reply / out-of-office.
 *
 * @param subject Email subject line
 * @param body    Plain-text email body (HTML stripped if possible)
 * @param headers Optional map of lowercase header name → value
 */
export function detectAutoReply(
  subject: string | null | undefined,
  body: string | null | undefined,
  headers?: Record<string, string>
): AutoReplyCheck {
  // 1. Headers — the authoritative signal
  if (headers) {
    for (const name of AUTO_REPLY_HEADERS) {
      const value = headers[name]?.toLowerCase();
      if (!value) continue;
      if (name === "auto-submitted" && value !== "no") {
        return { isAutoReply: true, reason: `Auto-Submitted: ${value}` };
      }
      if (name === "precedence" && /\b(auto_reply|bulk|list|junk)\b/.test(value)) {
        return { isAutoReply: true, reason: `Precedence: ${value}` };
      }
      if (name.startsWith("x-auto")) {
        return { isAutoReply: true, reason: `${name}: ${value}` };
      }
    }
  }

  // 2. Subject
  const subj = (subject ?? "").trim();
  for (const pattern of AUTO_REPLY_SUBJECT_PATTERNS) {
    if (pattern.test(subj)) {
      return { isAutoReply: true, reason: `Subject matches ${pattern}` };
    }
  }

  // 3. Body — scan first 500 chars only (auto-replies front-load their message)
  const bodySnippet = (body ?? "").slice(0, 500);
  for (const pattern of AUTO_REPLY_BODY_PATTERNS) {
    if (pattern.test(bodySnippet)) {
      return { isAutoReply: true, reason: `Body matches ${pattern}` };
    }
  }

  return { isAutoReply: false, reason: "" };
}
