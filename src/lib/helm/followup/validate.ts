// src/lib/helm/followup/validate.ts
// The guardrails that live in CODE, not only in the prompt (build brief,
// "Hard guardrails" + "Validated in code after the model"). Pure module.

export const BANNED_PHRASES = [
  "just checking in", "just following up", "following up on my last email", "bumping this",
  "circling back", "touching base", "as per my last email", "i never heard back",
  "did you get my email", "thoughts?", "any update?", "last chance", "limited time offer",
  "act now", "don't miss out", "do not miss out", "circle back", "touch base",
  "just checking", "i hope this finds you", "i hope this note finds you", "i hope this email finds you",
  "hope this email finds you", "i hope this message finds you",
];

export type DraftLike = { channel?: string; subject?: string; body?: string; voice_note_script?: string; touch_type?: string };

export type CheckContext = {
  realUrgency: boolean; // a dated field (option expiry / early-booking / client date) exists
  availabilityKnown: boolean; // George stored a real availability fact
  knownAmounts: string[]; // every number that appears in the Helm data (fees, budget)
  forbiddenTouchTypes: string[];
  yachtFacts?: { name: string; text: string }[]; // each proposed yacht's data, lower-cased JSON
  allowedChannels: string[];
  isAgent: boolean;
};

export function wordCount(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length;
}

const URGENCY = /\b(expir(e|es|ing|y)|deadline|last chance|only (one|two|three|\d+) (left|remaining)|book(ing|ed)? (up )?fast|going fast|before (it|they)('s| are| is)? gone|won'?t last|running out)\b/i;
const SOFT_SCARCITY = /\b(fill(s|ing)? up|calendars? (fill|close)|secure (their|your|the) (preferred )?(yacht|week|dates)|get(s|ting)? booked|book(s|ed)? (out|early|up)|limited availability|in high demand|demand is high)\b/i;
const NOT_SOLO = /\b(my|our) (team|colleagues?|assistant|office staff)\b|\bmy colleague\b/i;

// Yacht features a draft might claim. If a sentence names a proposed yacht and
// one of these, the yacht's own data must contain it (checked 16/11/2026: a
// draft said FREEDOM has stabilisers; the data says so only for three others).
const FEATURES: [RegExp, RegExp][] = [
  [/stabili[sz]er/i, /stabili[sz]/],
  [/jacuzzi|hot tub|spa pool/i, /jacuzzi|hot tub|spa pool|whirlpool/],
  [/\bgym\b|fitness/i, /gym|fitness/],
  [/sauna|hammam|steam room/i, /sauna|hammam|steam/],
  [/jet ?ski|waverunner|wave runner/i, /jet ?ski|waverunner|wave runner/],
  [/seabob/i, /seabob/],
  [/starlink|wi-?fi/i, /starlink|wi-?fi|internet/],
  [/elevator|\blift\b/i, /elevator|\blift\b/],
  [/air[- ]?condition/i, /air[- ]?condition|a\/c/],
  [/water ?slide|inflatable slide/i, /slide/],
  [/e-?foil|efoil/i, /foil/],
];

export function featureClaims(body: string, yachts: { name: string; text: string }[]): string[] {
  const out: string[] = [];
  const sentences = body.split(/(?<=[.!?])\s+|\n+/);
  for (const sen of sentences) {
    if (/\b(confirm|confirming|check|checking|verify|ask(ing)? the captain|find out)\b/i.test(sen)) continue;
    const named = yachts.filter((y) => y.name && sen.toLowerCase().includes(y.name.toLowerCase().replace(/[’']\s*$/, "").slice(0, 24)));
    if (!named.length) continue;
    for (const [claim, evidence] of FEATURES) {
      if (!claim.test(sen)) continue;
      if (/\b(no|not|without|doesn'?t|does not|lacks?)\b/i.test(sen)) continue;
      for (const y of named) if (!evidence.test(y.text)) out.push(`says ${y.name} has "${sen.match(claim)?.[0]}", which is not in that yacht's data`);
    }
  }
  return out;
}

const AVAILABILITY_CLAIM = /\b(still|remains?|is|are) (fully )?available\b|\bchecked (again )?(with|this morning)\b/i;
const MONEY = /(?:[€$]\s?\d[\d,.]*\s?k?\b|\b\d[\d,.]*\s?(?:k\s?)?(?:eur|euros?|usd|dollars)\b)/gi;
const EM_DASH = /[—–]/;

function normAmount(s: string): string {
  const digits = s.toLowerCase().replace(/[^\dk.]/g, "");
  if (digits.endsWith("k")) return String(Math.round(parseFloat(digits) * 1000));
  return String(Math.round(parseFloat(digits.replace(/,/g, ""))));
}

/** Problems with one draft. Empty array = clean. */
export function checkDraft(d: DraftLike, ctx: CheckContext): string[] {
  const p: string[] = [];
  const body = d.body ?? "";
  const all = `${d.subject ?? ""}\n${body}\n${d.voice_note_script ?? ""}`;
  const lower = all.toLowerCase();
  for (const b of BANNED_PHRASES) if (lower.includes(b)) p.push(`banned phrase "${b}"`);
  if (EM_DASH.test(all)) p.push("contains an em/en dash (use a hyphen or a comma)");
  // Line 1 after the greeting must be personal or new information (SKILL STEP 6).
  const firstLine = body.split("\n").map((l) => l.trim()).filter(Boolean).find((l, i) => i > 0 || !/^(dear|hi|hey|hello|good (morning|afternoon|evening))\b/i.test(l)) ?? "";
  if (/^i hope\b/i.test(firstLine)) p.push(`opens with "${firstLine.slice(0, 40)}…": line 1 must be personal or new information, not "I hope…"`);
  if (/[\u0370-\u03FF\u1F00-\u1FFF]/.test(all)) p.push("client-facing text contains Greek; write it in English (Greek is only for the _el fields)");
  const ch = d.channel ?? "email";
  if (ch === "email") {
    const w = wordCount(body);
    const min = d.touch_type === "holiday_greeting_no_ask" ? 15 : 40; // a greeting with no ask may be short
    if (w < min || w > 170) p.push(`email body is ${w} words (target 50-150)`);
    const sw = wordCount(d.subject ?? "");
    if (sw < 2 || sw > 8) p.push(`subject is ${sw} words (target 2-6)`);
  } else if (ch === "whatsapp" || ch === "imessage") {
    if (wordCount(body) > 50) p.push(`${ch} message is ${wordCount(body)} words (max 45)`);
  }
  if (d.voice_note_script && wordCount(d.voice_note_script) > 120) p.push("voice-note script longer than ~45 seconds");
  if (!ctx.realUrgency && URGENCY.test(all)) p.push("urgency/deadline language without a dated field in the Helm (no option expiry or early-booking deadline is stored)");
  if (!ctx.availabilityKnown && AVAILABILITY_CLAIM.test(all)) p.push("claims availability was checked/confirmed, but no availability fact is stored");
  if (!ctx.realUrgency && SOFT_SCARCITY.test(all)) p.push("soft scarcity (\"calendars fill up\", \"secure now\") without a dated fact in the Helm");
  if (NOT_SOLO.test(all)) p.push("George works alone: never \"my team\", \"our office\", \"my colleague\"");
  if (ctx.yachtFacts?.length) p.push(...featureClaims(body, ctx.yachtFacts));
  const known = new Set(ctx.knownAmounts.map(normAmount));
  for (const m of all.match(MONEY) ?? []) {
    if (!known.has(normAmount(m))) p.push(`amount "${m.trim()}" is not in the Helm data`);
  }
  if (d.touch_type && ctx.forbiddenTouchTypes.includes(d.touch_type)) p.push(`touch type "${d.touch_type}" was used last time`);
  if (ch && ch !== "none" && ctx.allowedChannels.length && !ctx.allowedChannels.includes(ch)) p.push(`channel "${ch}" is not allowed for this client`);
  if (ctx.isAgent && /\b(dear (mr|mrs|ms|dr)\.?)\b/i.test(body)) p.push("travel advisors are written to by first name, never Dear Mr/Mrs");
  if (/\b(attached|attachment|enclosed|i('| a)m (re-?)?sending (it|the proposal) (now|here))\b/i.test(body)) p.push("promises an attachment, but a follow-up cannot carry files (say the proposal comes in a separate email, or re-share the link)");
  return p;
}

export function deDash(s: string): string {
  return s
    .replace(/\s?[—–]\s?/g, ", ").replace(/,\s*,/g, ",")
    .replace(/^[ \t]*[*•][ \t]+/gm, "- ") // markdown bullets read badly in a plain email
    .replace(/\*\*([^*\n]+)\*\*/g, "$1"); // and so does **bold**
}

export const OPT_OUT = /\b(unsubscribe|stop (emailing|contacting|messaging)|remove me|take me off|not interested|please (do not|don'?t) (contact|email|write)|no longer (interested|looking))\b/i;

export type ScenarioHint = { code: string; name: string };

/** George already sent the honest close ("Have you set Greece aside? … I'll
 *  close the file"). After it the playbook says nurture, not more chasing. */
export const BREAKUP_SENT = /\b(close (the|your|my) file|set (greece|the (greece )?plan|it|your plans?) aside|i('| wi)ll stop (writing|reaching)|won'?t (write|trouble you) again|last (note|email|message) from me|not (be )?clutter(ing)? your inbox)\b/i;

/** The code's first read of the scenario (SKILL STEP 2, first match wins).
 *  The model may refine S2-S5 from the words; it may not override S0. */
export function scenarioHint(a: {
  status: string;
  hasOutbound: boolean;
  ball: "client_owes" | "we_owe" | "none";
  lastInboundText: string;
  lastInboundAt: string | null;
  hadInbound: boolean;
  consecutiveUnanswered: number;
  clientFollowupDate: string | null;
  nowIso: string;
  lastOutboundText?: string;
}): ScenarioHint {
  if (a.status === "do_not_contact" || (a.lastInboundText && OPT_OUT.test(a.lastInboundText))) return { code: "S0", name: "DO_NOT_CONTACT" };
  if (a.status === "won") return { code: "S11", name: "BOOKED" };
  if (!a.hasOutbound) return { code: "S1", name: "NEW_REQUEST" };
  if (a.ball === "we_owe") {
    if (/\b(discount|best (price|rate)|lower|too (high|expensive)|% off|reduce|better price)\b/i.test(a.lastInboundText)) return { code: "S4", name: "DISCOUNT" };
    return { code: "S2", name: "WE_OWE" };
  }
  if (a.clientFollowupDate && a.clientFollowupDate > a.nowIso.slice(0, 10)) return { code: "S6", name: "CLIENT_SCHEDULED" };
  if (a.lastInboundAt && Date.parse(a.nowIso) - Date.parse(a.lastInboundAt) <= 3 * 86400000) return { code: "S3", name: "ENGAGED" };
  if (a.status === "lost" || (a.lastOutboundText && BREAKUP_SENT.test(a.lastOutboundText))) return { code: "S10", name: "NURTURE" };
  if (a.consecutiveUnanswered >= 7) return { code: "S9", name: "POST_7" };
  if (a.hadInbound) return { code: "S7", name: "GHOSTED" };
  return { code: "S8", name: "NEW_NO_REPLY" };
}
