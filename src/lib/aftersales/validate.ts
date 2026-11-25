// src/lib/aftersales/validate.ts — the rules that live in CODE (pure module).

import type { Kind } from "./plan";
import { GOOGLE_REVIEW_LINK } from "./plan";
import { BANNED_PHRASES, wordCount } from "@/lib/helm/followup/validate";

const LIMITS: Record<Kind, [number, number]> = {
  thank_you: [45, 140], review: [40, 120], review_after_problem: [50, 150], birthday: [15, 70],
  holiday: [50, 150], anniversary: [20, 80], next_season: [45, 120], advisor_report: [70, 190],
};
const URGENCY = /\b(expir(e|es|ing|y)|deadline|last chance|limited|book(ing|ed)? (up )?(fast|early)|going fast|won'?t last|running out|fill(s|ing)? up|calendars? (fill|close)|secure (your|the) (preferred )?(yacht|week|dates)|in high demand|don'?t miss)\b/i;
const NOT_SOLO = /\b(my|our) (team|colleagues?|assistant|office staff)\b|\bmy colleague\b/i;
// "stars" alone is not enough: a yacht can be called EFFIE STAR.
const REVIEW_ASK = /\b(reviews?|five[- ]stars?|5[- ]stars?|rating|rate us|trustpilot|tripadvisor)\b/i;
const MONEY = /[€$]\s?\d|\b\d[\d,.]*\s?(eur|euros?|usd|dollars)\b|\bdiscount|% off/i;

export function checkAfterSales(kind: Kind, d: { subject: string; body: string }, expect: { greeting: string; fullName: string }): string[] {
  const p: string[] = [];
  const all = `${d.subject}\n${d.body}`;
  const lower = all.toLowerCase();
  for (const b of BANNED_PHRASES) if (lower.includes(b)) p.push(`banned phrase "${b}"`);
  if (/[—–]/.test(all)) p.push("contains a long dash (use a comma or a hyphen)");
  if (/[Ͱ-Ͽἀ-῿]/.test(all)) p.push("contains Greek; the email is in English");
  if (/[“”‘’]/.test(d.subject)) p.push("smart quotes in the subject");
  if (/[\u{1F300}-\u{1FAFF}]/u.test(all)) p.push("emoji");
  if (URGENCY.test(all)) p.push("urgency or scarcity language");
  if (NOT_SOLO.test(all)) p.push('George works alone: never "my team" or "our office"');
  if (MONEY.test(all)) p.push("mentions money, a price or a discount");
  const lines = d.body.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== expect.greeting) p.push(`first line must be exactly "${expect.greeting}"`);
  if (/^i hope\b/i.test(lines[1] ?? "")) p.push('line 1 after the greeting must not start with "I hope"');
  const parts = expect.fullName.trim().split(/\s+/).filter((x) => x.length > 2);
  if (parts.length >= 3 && lower.includes(expect.fullName.trim().toLowerCase())) p.push("uses the full legal name; use the first name only");
  const urls = all.match(/https?:\/\/\S+/g) ?? [];
  const isReview = kind === "review" || kind === "review_after_problem";
  if (isReview) {
    if (!d.body.includes(GOOGLE_REVIEW_LINK)) p.push(`the Google review link must appear exactly once: ${GOOGLE_REVIEW_LINK}`);
    if (urls.some((u) => !u.startsWith(GOOGLE_REVIEW_LINK))) p.push("only the Google review link is allowed");
    if (/trustpilot/i.test(all)) p.push("never Trustpilot");
    if (/\b(5|five)[- ]star|mention (the )?(captain|crew)/i.test(all)) p.push("never ask for stars or for what to write");
  } else {
    if (urls.length) p.push("no links in this message");
    if (kind !== "advisor_report" && REVIEW_ASK.test(all)) p.push("no review ask in this message");
  }
  if (/\[[^\]\n]{2,60}\]/.test(d.body)) p.push("has [brackets] left to fill in");
  const w = wordCount(d.body);
  const [min, max] = LIMITS[kind];
  if (w < min || w > max) p.push(`body is ${w} words (target ${min}-${max})`);
  const sw = wordCount(d.subject);
  if (sw < 2 || sw > 8) p.push(`subject is ${sw} words (target 2-7)`);
  return p;
}
