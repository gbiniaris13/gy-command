// Which central agencies have ALREADY received the broker-to-supplier inquiry.
// Every send logs an outbound helm_message whose body starts:
//   [Central agency inquiry -> a@x.com, b@y.com - sent individually, ...]
// We parse those header lines so a later send goes ONLY to agencies that have
// not been contacted yet — never re-emailing one that already got the inquiry.

import { extractEmails } from "./recipients";

const TAG = "[Central agency inquiry ->";

export function agencyAlreadySent(
  messages: { direction?: string | null; body?: string | null }[],
): string[] {
  const out = new Set<string>();
  for (const m of messages || []) {
    if (m.direction !== "outbound" || !m.body) continue;
    if (!m.body.startsWith(TAG)) continue;
    const close = m.body.indexOf("]");
    const header = m.body.slice(TAG.length, close > 0 ? close : undefined);
    for (const e of extractEmails(header)) out.add(e.toLowerCase());
  }
  return [...out];
}

// Split a resolved recipient list into the ones still to contact vs the ones
// already contacted (case-insensitive).
export function splitNewVsSent(
  recipients: string[],
  alreadySent: string[],
): { fresh: string[]; skipped: string[] } {
  const sent = new Set(alreadySent.map((e) => e.toLowerCase()));
  const fresh: string[] = [];
  const skipped: string[] = [];
  for (const r of recipients) (sent.has(r.toLowerCase()) ? skipped : fresh).push(r);
  return { fresh, skipped };
}
