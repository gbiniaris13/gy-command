// Warmup-email detector.
//
// Cold-outreach warmup services (Mailwarm, Lemwarm, Smartlead, Warmup
// Inbox, Warmy, Warmbox, Instantly, Folderly, etc.) build sender
// reputation by swapping fake "human" emails between participant
// inboxes. They flood george@ and eleanna@ with thousands of
// "thanks!", "got it", "looks good" replies every week.
//
// We detect them with three lines of defence, strongest first:
//
//   1. Service-specific headers (X-Mailwarm, X-Lemwarm, X-Warmup-*,
//      X-Smartlead-Warmup, etc.) — these are added by the service
//      itself and are a definitive tell.
//   2. Message-ID domain — most services route through a dedicated
//      subdomain (@send.warmup-inbox.com, @mailwarm.com, etc.).
//   3. Content heuristic — very short body + generic 1-2-word reply
//      matching the classic warmup template ("thanks!", "got it",
//      "perfect", "noted", "will do", etc.).
//
// Any match → email is archived out of inbox and never touches the
// CRM. Full stop.

export type WarmupVerdict = {
  isWarmup: boolean;
  reason?: string;
  service?: string;
};

// Gmail header keys come lowercased from our cron (headersMap).
const SERVICE_HEADER_MARKERS: Array<[RegExp, string]> = [
  [/^x-mailwarm/, "mailwarm"],
  [/^x-lemwarm/, "lemwarm"],
  [/^x-warmup-inbox/, "warmup-inbox"],
  [/^x-warmupinbox/, "warmup-inbox"],
  [/^x-smartlead-warmup/, "smartlead"],
  [/^x-smartlead/, "smartlead"],
  [/^x-warmy/, "warmy"],
  [/^x-warmbox/, "warmbox"],
  [/^x-instantly-warmup/, "instantly"],
  [/^x-instantly/, "instantly"],
  [/^x-folderly/, "folderly"],
  [/^x-mailshake-warmup/, "mailshake"],
  [/^x-allegrow/, "allegrow"],
  [/^x-mailreach/, "mailreach"],
  [/^x-warmer/, "warmer"],
  [/^x-mailflow/, "mailflow"],
  [/^x-gmass-warmup/, "gmass"],
  [/^x-warmeer/, "warmeer"],
  [/^x-toldu/, "toldu"],
];

const MSG_ID_MARKERS: Array<[RegExp, string]> = [
  [/@(?:[\w-]+\.)*mailwarm\./i, "mailwarm"],
  [/@(?:[\w-]+\.)*warmup-inbox\./i, "warmup-inbox"],
  [/@(?:[\w-]+\.)*warmupinbox\./i, "warmup-inbox"],
  [/@(?:[\w-]+\.)*lemwarm\./i, "lemwarm"],
  [/@(?:[\w-]+\.)*smartlead\./i, "smartlead"],
  [/@(?:[\w-]+\.)*instantly\.(?:ai|com)/i, "instantly"],
  [/@(?:[\w-]+\.)*warmy\./i, "warmy"],
  [/@(?:[\w-]+\.)*warmbox\./i, "warmbox"],
  [/@(?:[\w-]+\.)*folderly\./i, "folderly"],
  [/@(?:[\w-]+\.)*mailreach\./i, "mailreach"],
  [/@(?:[\w-]+\.)*allegrow\./i, "allegrow"],
  [/@(?:[\w-]+\.)*mailshake\.com/i, "mailshake"],
  [/warmup[_-](?:reply|msg|id|send)/i, "generic-warmup"],
];

// Body/subject content shortcuts — only a *very* short body that is
// ALSO a classic warmup template string counts. We want zero
// false-positives for real prospects who happen to reply briefly.
const WARMUP_BODY_TEMPLATES =
  /^\s*(?:(?:great|thanks|thank\s+you|got\s+it|received|on\s+it|perfect|noted|sounds\s+good|will\s+do|appreciate\s+it|appreciate\s+this|cheers|awesome|nice|excellent|brilliant|amazing|wonderful|fantastic|looking\s+forward(?:\s+to\s+it)?|sure\s+thing|absolutely|of\s+course|agreed|sounds\s+great|looks\s+good|👍|😀|🙏)[.!]*\s*){1,4}$/i;

const WARMUP_SIGNATURE_HINTS = /(?:warmup|engagement\s*booster|deliverability\s*test|sender\s+reputation)/i;

function stripThreadTail(body: string): string {
  // Kill quoted lines + "On … wrote:" blocks that warmup services don't have.
  return (body || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .split(/\bOn\b [^\n]{4,120}\bwrote:/i)[0]
    .split(/[\r\n]{1,2}-{2,} *(Original Message|Forwarded message|Original Mail)/i)[0]
    .trim();
}

export function detectWarmup(args: {
  from: string;
  subject: string;
  body: string;
  headers: Record<string, string>;
}): WarmupVerdict {
  // 1. Service-specific headers
  for (const key of Object.keys(args.headers)) {
    for (const [pattern, service] of SERVICE_HEADER_MARKERS) {
      if (pattern.test(key)) {
        return { isWarmup: true, reason: `header:${key}`, service };
      }
    }
  }

  // 2. Message-ID domain fingerprint (includes X-Original-Message-ID
  //    for forwarded warmup mail)
  const candidateIds = [
    args.headers["message-id"],
    args.headers["x-original-message-id"],
    args.headers["references"],
    args.headers["in-reply-to"],
  ]
    .filter(Boolean)
    .join(" ");
  for (const [pattern, service] of MSG_ID_MARKERS) {
    if (pattern.test(candidateIds)) {
      return { isWarmup: true, reason: "msg-id domain", service };
    }
  }

  // 3. Content heuristic — very short + matches classic templates.
  //    Keeps a tight ceiling (≤120 chars, after stripping thread tails
  //    and signatures) so real prospects' brief replies still pass.
  const trimmed = stripThreadTail(args.body).trim();
  if (trimmed.length > 0 && trimmed.length <= 120 && WARMUP_BODY_TEMPLATES.test(trimmed)) {
    return { isWarmup: true, reason: "template-body", service: "generic" };
  }
  if (WARMUP_SIGNATURE_HINTS.test(trimmed)) {
    return { isWarmup: true, reason: "signature-hint", service: "generic" };
  }

  return { isWarmup: false };
}
