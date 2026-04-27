// Sprint 2.1 — Unified message classifier.
//
// Every email_inbound message gets classified into one of:
//
//   awaits_reply   — real message asking/requesting/briefing; needs response
//   informational  — FYI, status update, no response needed but useful
//   closing        — "thanks!", "talk soon", end-of-conversation pleasantry
//   declined       — explicit no, "moved on", "not interested"
//   parked         — self-parked: "I'll be in touch when…", "in due course"
//   auto_response  — out-of-office, automated template, system reply
//   reaction       — Gmail/Outlook reaction notification (X reacted to your message)
//   unknown        — nothing else fits (rare; AI fallback)
//
// The thread analyzer ignores everything except awaits_reply +
// informational when computing "last meaningful message". This is
// the root fix for v2 bugs 1, 2, 3, 4, 5, 6.
//
// Detection runs in two layers:
//   1. Cheap heuristics (subject patterns, header sniffing, body
//      regexes) → catches the obvious 80%.
//   2. AI verification for the rest → catches semantic edge cases.
//
// All classifications are persisted on activities.message_class +
// activities.message_class_confidence so the analyzer doesn't
// re-classify on every read.

import { aiChat } from "@/lib/ai";

export type MessageClass =
  | "awaits_reply"
  | "informational"
  | "closing"
  | "declined"
  | "parked"
  | "auto_response"
  | "reaction"
  | "unknown";

export interface MessageClassification {
  message_class: MessageClass;
  confidence: number;
  reason: string;
  /** For "parked": estimated date the contact will re-engage. */
  parked_until: string | null;
  /** For "declined": short reason if extractable. */
  decline_reason: string | null;
}

interface MessageInput {
  /** Raw From header value. Used to detect reactions where From === self. */
  from: string;
  /** Self email — typically george@georgeyachts.com. */
  self_email?: string;
  /** Raw subject. */
  subject: string;
  /** First ~2000 chars of body text. */
  body: string;
  /** Raw headers map (lowercased keys), if available. */
  headers?: Record<string, string>;
}

// ─── Layer 1: cheap heuristics ──────────────────────────────────────

const AUTO_RESPONSE_SUBJECT_RE =
  /^\s*(auto(matic)?\s*[-:]?\s*reply|automated\s+reply|out\s+of\s+(the\s+)?office|ooo|away\s+from\s+(the\s+)?office|currently\s+out|thank\s+you\s+for\s+(your\s+email|reaching\s+out|contacting)|absent\b|on\s+leave|out\s+today|i\s+am\s+out|will\s+respond|away\s+message)/i;

const AUTO_RESPONSE_BODY_PHRASES = [
  /\bout\s+of\s+(the\s+)?office\b/i,
  /\bautomated\s+(response|reply)\b/i,
  /\bauto[-\s]?(reply|generated|response)\b/i,
  /\b(will|i'll)\s+(respond|reply|be\s+back|return)\s+(when|on|after)\b/i,
  /\blimited\s+access\s+to\s+(my\s+)?email/i,
  /\bcurrently\s+(travel(l)?ing|out\s+of\s+office|away)/i,
  /\bplease\s+note\s+i\s+(will|am)\b/i,
  /\bi\s+am\s+(currently\s+)?(out\s+of\s+office|on\s+(vacation|leave|holiday|maternity|paternity))/i,
  /\bthanks\s+for\s+reaching\s+out.\s+(i|i'm|i\s+am)\s+currently/i,
  /\bi\s+wanted\s+to\s+confirm\s+receipt\s+of\s+your\s+email\b/i,
  /\bappreciate\s+your\s+patience\s+during/i,
  /\bback\s+(in\s+the\s+office|at\s+my\s+desk)\s+on\b/i,
];

const REACTION_BODY_RE =
  /^\s*[^\n]{1,80}\s+(reacted|liked|loved|laughed|emphasized|disliked)\s+to\s+(your|the)\s+(message|email)/i;

const CLOSING_BODY_RES = [
  // Pure thanks/pleasantry endings
  /^\s*(thanks?(\s+(again|so\s+much|a\s+lot))?|thank\s+you(\s+too)?(\s+george)?|thx|cheers|appreciated|sounds\s+(great|good|perfect)|perfect|noted|got\s+it|will\s+do|talk\s+soon|speak\s+soon|catch\s+up\s+soon|all\s+the\s+best|best(\s+wishes)?|kind\s+regards|warm\s+regards|regards|enjoy|have\s+a\s+(great|good)\s+(day|weekend|trip))[\s,!.:)😊🙂👍]*$/i,
];

const DECLINE_BODY_PHRASES = [
  /\bwe\s+(do\s+not|don't|cannot|can't)\s+(permit|allow|accept)\s+(official\s+)?(partnerships?|collaborations?)\b/i,
  /\bnot\s+(a\s+)?(fit|interested|right\s+(time|fit))\b/i,
  /\b(unfortunately|sorry)\s+(but\s+)?(we|i)\s+(have\s+to\s+)?(decline|pass|cannot\s+(proceed|engage|help))/i,
  /\bclient\s+has\s+(moved\s+on|gone\s+(in\s+)?another\s+direction|chosen\s+(a\s+)?different)/i,
  /\bdecided\s+(to|not)\s+(go|proceed)\s+(in\s+)?(another|a\s+different)\s+direction/i,
  /\bthank(s|\s+you)?\s+for\s+your\s+time(\s+but)?[,.\s]*(at\s+this\s+(point|stage|time)\s+)?(we|i|the\s+client)\s+(are\s+not|will\s+not|won't|don't|do\s+not)/i,
  /\bremove\s+(me|us)\s+from\s+(your\s+)?(mailing\s+list|distribution)/i,
];

const PARKED_BODY_PHRASES = [
  /\bi(?:'ll| will)\s+(?:be\s+in\s+touch|reach\s+out|come\s+back|circle\s+back|reconnect|follow\s+up)(?:\s+with\s+you)?(?:\s+(when|once|after|in)\s+([^.,!?]{2,80}))?/i,
  /\bin\s+due\s+course\b/i,
  /\bonce\s+(we|i)\s+(have|finalize|confirm|secure)/i,
  /\bafter\s+(the\s+)?(holidays?|summer|season|trip|wedding|event)\b/i,
  /\bat\s+a\s+later\s+(date|stage|time)\b/i,
  /\bcheck\s+back\s+(with\s+you\s+)?(in|next|at)\b/i,
  /\bcome\s+back\s+to\s+you\s+(in|when|once|after|next)\b/i,
];

function detectReaction(input: MessageInput): boolean {
  // Reaction emails are FROM self (Gmail/Outlook send a notification
  // about your own message receiving a reaction).
  if (input.self_email && input.from) {
    const fromLower = input.from.toLowerCase();
    if (fromLower.includes(input.self_email.toLowerCase())) {
      // Confirm via body pattern.
      if (REACTION_BODY_RE.test(input.body)) return true;
    }
  }
  // Body pattern alone is also strong (some clients use a different
  // sender for reactions).
  return REACTION_BODY_RE.test(input.body);
}

function detectAutoResponse(input: MessageInput): {
  hit: boolean;
  reason?: string;
} {
  const headers = input.headers ?? {};
  // RFC 3834 Auto-Submitted header is definitive.
  const autoSubmitted = (headers["auto-submitted"] ?? "").toLowerCase();
  if (
    autoSubmitted &&
    autoSubmitted !== "no" &&
    autoSubmitted !== ""
  ) {
    return { hit: true, reason: `auto-submitted:${autoSubmitted}` };
  }
  // X-Auto-Response-Suppress also indicates automated mail.
  if (headers["x-auto-response-suppress"]) {
    return { hit: true, reason: "x-auto-response-suppress" };
  }
  const precedence = (headers["precedence"] ?? "").toLowerCase();
  if (
    precedence === "bulk" ||
    precedence === "auto_reply" ||
    precedence === "junk"
  ) {
    return { hit: true, reason: `precedence:${precedence}` };
  }
  // Subject patterns
  if (AUTO_RESPONSE_SUBJECT_RE.test(input.subject ?? "")) {
    return { hit: true, reason: "subject_pattern" };
  }
  // Body phrase match (need at least one strong phrase)
  for (const re of AUTO_RESPONSE_BODY_PHRASES) {
    if (re.test(input.body ?? "")) {
      return { hit: true, reason: `body:${re.source.slice(0, 40)}` };
    }
  }
  return { hit: false };
}

function detectClosing(input: MessageInput): boolean {
  // Strip quoted lines + signature blocks before testing — closings
  // are usually short standalone bodies.
  const cleaned = (input.body ?? "")
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .split(/^--\s*$/m)[0]
    .trim();
  // Closing patterns only match if the cleaned body is short
  // (≤ ~200 chars). Anything longer probably has substance.
  if (cleaned.length > 240) return false;
  return CLOSING_BODY_RES.some((re) => re.test(cleaned));
}

function detectDecline(input: MessageInput): {
  hit: boolean;
  reason?: string;
} {
  for (const re of DECLINE_BODY_PHRASES) {
    if (re.test(input.body ?? "")) {
      return { hit: true, reason: re.source.slice(0, 60) };
    }
  }
  return { hit: false };
}

function detectParked(input: MessageInput): {
  hit: boolean;
  parked_until: string | null;
} {
  for (const re of PARKED_BODY_PHRASES) {
    const m = (input.body ?? "").match(re);
    if (m) {
      const tail = (m[2] ?? m[1] ?? "").toLowerCase();
      const date = parseTailDate(tail);
      return { hit: true, parked_until: date };
    }
  }
  return { hit: false, parked_until: null };
}

function parseTailDate(tail: string): string | null {
  const now = new Date();
  // Common references George writes / sees in inbound.
  const monthMap: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8,
    oct: 9, nov: 10, dec: 11,
  };
  const mMonth = tail.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/);
  if (mMonth) {
    const monthIdx = monthMap[mMonth[1]];
    const year = /\b\d{4}\b/.test(tail)
      ? parseInt(tail.match(/\b(\d{4})\b/)![1], 10)
      : monthIdx >= now.getMonth()
        ? now.getFullYear()
        : now.getFullYear() + 1;
    const day = /\b(\d{1,2})\b/.test(tail)
      ? Math.min(28, parseInt(tail.match(/\b(\d{1,2})\b/)![1], 10))
      : 1;
    return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (/\bend\s+of\s+(year|2026)\b/.test(tail)) return "2026-12-31";
  if (/\bnext\s+year\b/.test(tail)) return `${now.getFullYear() + 1}-06-30`;
  if (/\bsummer\b/.test(tail)) return `${now.getFullYear()}-07-15`;
  if (/\bafter\s+(the\s+)?holidays?\b/.test(tail))
    return `${now.getFullYear() + 1}-01-15`;
  // Vague: default +6 months
  if (/\b(later|due\s+course|next|when)\b/.test(tail)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

// ─── Heuristic classifier ──────────────────────────────────────────

function heuristicClassify(input: MessageInput): MessageClassification | null {
  // Reaction has highest precedence (it's a system email, not a real reply)
  if (detectReaction(input)) {
    return {
      message_class: "reaction",
      confidence: 0.95,
      reason: "reaction body pattern",
      parked_until: null,
      decline_reason: null,
    };
  }
  const ar = detectAutoResponse(input);
  if (ar.hit) {
    return {
      message_class: "auto_response",
      confidence: 0.9,
      reason: ar.reason ?? "heuristic",
      parked_until: null,
      decline_reason: null,
    };
  }
  if (detectClosing(input)) {
    return {
      message_class: "closing",
      confidence: 0.8,
      reason: "short pleasantry",
      parked_until: null,
      decline_reason: null,
    };
  }
  const dec = detectDecline(input);
  if (dec.hit) {
    return {
      message_class: "declined",
      confidence: 0.85,
      reason: `decline phrase: ${dec.reason}`,
      parked_until: null,
      decline_reason: dec.reason ?? null,
    };
  }
  const parked = detectParked(input);
  if (parked.hit) {
    return {
      message_class: "parked",
      confidence: 0.75,
      reason: "self-park phrase",
      parked_until: parked.parked_until,
      decline_reason: null,
    };
  }
  return null;
}

// ─── AI verification layer ─────────────────────────────────────────

const AI_SYSTEM = `You classify a single email message for a yacht broker's inbox CRM.

CRITICAL OUTPUT RULES:
- Output ONLY a raw JSON object. NO markdown fences. NO prose.
- Start with { end with }.
- Schema: {"class":"<CLASS>","confidence":<0..1>,"reason":"<short>","parked_until":"<YYYY-MM-DD or null>","decline_reason":"<text or null>"}

Allowed CLASS values:
- awaits_reply: contains a question, request, ask, brief, proposal, meeting offer — needs a response
- informational: FYI, confirmation, status update — useful but no specific ask
- closing: "thanks", "great talking", "talk soon", end-of-thread pleasantry — no response needed
- declined: explicit no, "we don't permit", "client moved on", "not interested" — relationship over
- parked: contact says "I'll be in touch when X" — extract parked_until if a date can be inferred
- auto_response: out-of-office / automated template / system reply
- reaction: Gmail/Outlook reaction notification ("X reacted to your message")
- unknown: nothing fits

Be conservative: if a message says "Thanks for the info, I'll get back to you on Monday with the brief" it is BOTH closing AND parked, but the dominant class is awaits_reply (Monday brief is the commitment to wait for).`;

async function aiClassify(
  input: MessageInput,
): Promise<MessageClassification> {
  const userMsg = JSON.stringify({
    from: input.from,
    subject: input.subject ?? "",
    body: (input.body ?? "").slice(0, 2000),
  });
  let raw: string;
  try {
    raw = await aiChat(AI_SYSTEM, userMsg, {
      maxTokens: 600,
      temperature: 0.1,
    });
  } catch {
    return {
      message_class: "unknown",
      confidence: 0,
      reason: "ai call failed",
      parked_until: null,
      decline_reason: null,
    };
  }
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) {
    return {
      message_class: "unknown",
      confidence: 0,
      reason: "no json from ai",
      parked_until: null,
      decline_reason: null,
    };
  }
  try {
    const parsed = JSON.parse(m[0]) as Partial<{
      class: string;
      confidence: number;
      reason: string;
      parked_until: string | null;
      decline_reason: string | null;
    }>;
    const allowed: MessageClass[] = [
      "awaits_reply",
      "informational",
      "closing",
      "declined",
      "parked",
      "auto_response",
      "reaction",
      "unknown",
    ];
    const cls = (allowed as string[]).includes(parsed.class ?? "")
      ? (parsed.class as MessageClass)
      : "unknown";
    return {
      message_class: cls,
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      reason: parsed.reason ?? "ai",
      parked_until: parsed.parked_until ?? null,
      decline_reason: parsed.decline_reason ?? null,
    };
  } catch {
    return {
      message_class: "unknown",
      confidence: 0,
      reason: "ai json parse failed",
      parked_until: null,
      decline_reason: null,
    };
  }
}

/**
 * Public entry point. Tries heuristics first; only falls through to
 * AI if no heuristic fired. Always returns a classification.
 *
 * Set `useAi: false` to skip the AI fallback (faster + cheaper, used
 * by bulk backfills where we can re-classify later).
 */
export async function classifyMessage(
  input: MessageInput,
  options: { useAi?: boolean } = {},
): Promise<MessageClassification> {
  const useAi = options.useAi ?? true;
  const heur = heuristicClassify(input);
  if (heur) return heur;
  if (!useAi) {
    return {
      message_class: "unknown",
      confidence: 0,
      reason: "no heuristic match",
      parked_until: null,
      decline_reason: null,
    };
  }
  return aiClassify(input);
}

/**
 * For thread analysis: which message classes count as "meaningful"
 * (i.e., alter the owed/awaiting state)?
 */
export const MEANINGFUL_CLASSES: ReadonlySet<MessageClass> = new Set([
  "awaits_reply",
  "informational",
  "unknown", // be conservative — unknown counts as a real message
]);

/**
 * Classes that should NEVER be treated as "last meaningful message"
 * — they're noise from the thread analyzer's perspective.
 */
export const NOISE_CLASSES: ReadonlySet<MessageClass> = new Set([
  "auto_response",
  "reaction",
  "closing",
  "declined",
  "parked",
]);
