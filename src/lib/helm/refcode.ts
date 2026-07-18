// The Helm — George's reference code (2026-07-17, his own pre-Helm habit
// brought back): GY + DDMMYY + HHMM in Athens time, minted from the request's
// created_at. "GY1707261604" = created 17/07/26 at 16:04 Athens.
//
// DERIVED, never stored: every request (past and future) has a code with zero
// migration, and the code can be reversed into a created_at minute-window for
// search. Goes into every supplier-inquiry subject ("Ref GY…"), the request
// header, and the CRM list. Carries NOTHING about the client.

const TZ = "Europe/Athens";

function athensParts(iso: string): Record<string, string> {
  const d = new Date(iso);
  // hourCycle "h23" pins midnight to "00" on every ICU build. Without it,
  // hour12:false can resolve to h24 ("24:05"), and patching just the hour
  // would pair "00" with the WRONG day — corrupting the code at midnight.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** "2026-07-17T13:04:12Z" -> "GY1707261604" (Athens local). */
export function refCode(createdAt: string | null | undefined): string {
  if (!createdAt) return "";
  const p = athensParts(createdAt);
  if (!p.day) return "";
  return `GY${p.day}${p.month}${p.year}${p.hour}${p.minute}`;
}

/** Append " - Ref GY…" to an email subject, once. Idempotent: if the code is
 *  already there (e.g. George kept it while editing) it is not doubled. Used on
 *  BOTH the supplier inquiry and the client/agent proposal so one code threads
 *  the whole conversation (2026-07-17, George: "να υπάρχει και όταν στέλνουμε
 *  την προσφορά στον πελάτη"). */
export function subjectWithRef(subject: string, createdAt: string | null | undefined): string {
  const code = refCode(createdAt);
  const base = (subject ?? "").trim();
  if (!code) return base;
  if (base.toUpperCase().includes(code)) return base;
  return base ? `${base} - Ref ${code}` : `Ref ${code}`;
}

/** Parse "GY1707261604" (or with spaces/lowercase) into the UTC minute window
 *  it denotes, for created_at range search. Returns null if not a code. */
export function parseRefCode(q: string): { fromIso: string; toIso: string } | null {
  const m = q.trim().toUpperCase().replace(/\s+/g, "").match(/^GY(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yy, hh, min] = m;
  // Range-check before Date.UTC: it silently rolls invalid parts over
  // (day 99 -> next month), which would search a wrong-but-plausible window
  // instead of saying "not a code".
  if (Number(dd) < 1 || Number(dd) > 31 || Number(mm) < 1 || Number(mm) > 12
    || Number(hh) > 23 || Number(min) > 59) return null;
  // The code is Athens local time; scan a generous window (Athens is UTC+2/+3)
  // so we never miss the minute regardless of DST.
  const base = Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
  if (Number.isNaN(base)) return null;
  return {
    fromIso: new Date(base - 3 * 3600 * 1000).toISOString(),
    toIso: new Date(base - 1 * 3600 * 1000 + 60 * 1000).toISOString(),
  };
}
