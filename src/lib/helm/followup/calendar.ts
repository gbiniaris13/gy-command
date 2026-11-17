// src/lib/helm/followup/calendar.ts
// 2026-11-16 — the deterministic half of the follow-up engine.
//
// Everything with a date or a clock in it lives HERE, in plain code, never in
// the model: lead time and bucket, the decision deadline, the cadence from the
// research (.claude/skills/yacht-followup/SKILL.md, STEP 3), US blackout days,
// weekends, the client's own time zone and the send windows. The model only
// reads the conversation and writes the message.
//
// Pure module: relative imports only, no I/O, so `node --test` can run it.

export type Bucket = "ULTRA_SHORT" | "SHORT" | "MEDIUM" | "LONG" | "VERY_LONG" | "UNKNOWN";

export type TouchHint =
  | "availability_update" | "itinerary_idea" | "crew_bio" | "photo_video" | "voice_note"
  | "testimonial" | "all_in_cost_clarity" | "meltemi_weather_guide" | "greek_event"
  | "insider_tip" | "early_booking_deadline" | "new_yacht" | "discovery_question"
  | "one_click_question" | "no_oriented_question" | "forwardable_one_pager"
  | "alternative_dates_or_yacht" | "holiday_greeting_no_ask" | "journal_or_charter_index"
  | "permission_to_close";

/** One planned step. Same shape the Helm has used since July (due/done_at/
 *  how/kind), plus optional research fields. `v: 2` marks a plan built by
 *  this engine, so the old auto-extender leaves it alone. */
export type PlannedStep = {
  due: string; // YYYY-MM-DD, the client's local calendar day
  done_at: string | null;
  how: string | null;
  kind: "nudge" | "reopen" | "bye";
  v: 2;
  touch?: TouchHint;
  anchor?: string; // short human reason, e.g. "2028 rate cards landing"
  manual?: boolean; // George set this date by hand: the auto re-plan leaves it alone
};

const DAY = 86400000;

// ── Calendar-day arithmetic on plain YYYY-MM-DD strings (UTC noon, no DST) ──
export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T12:00:00Z`) + n * DAY;
  return new Date(t).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
}
/** 0 = Sunday … 6 = Saturday */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
function ymd(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d, 12)).toISOString().slice(0, 10);
}
/** n-th given weekday of a month (n = 1..5); n = -1 → last. */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  if (n > 0) {
    const first = ymd(y, m, 1);
    const shift = (wd - weekday(first) + 7) % 7;
    return addDays(first, shift + (n - 1) * 7);
  }
  const last = ymd(y, m + 1, 0);
  const back = (weekday(last) - wd + 7) % 7;
  return addDays(last, -back);
}
/** First given weekday on or after a date. */
function onOrAfter(date: string, wd: number): string {
  return addDays(date, (wd - weekday(date) + 7) % 7);
}

// ── Time zones (IANA, DST-aware via Intl; no library) ──────────────────────
function offsetMinutes(tz: string, utcMs: number): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = s.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  const v = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -v : v;
}
/** The local calendar day of an instant in a zone. */
export function localDate(utcMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(utcMs));
}
/** A wall-clock time in a zone → UTC epoch ms. */
export function zonedToUtc(date: string, hhmm: string, tz: string): number {
  const [h, mi] = hhmm.split(":").map(Number);
  const naive = Date.parse(`${date}T00:00:00Z`) + (h * 60 + mi) * 60000;
  let guess = naive - offsetMinutes(tz, naive) * 60000;
  guess = naive - offsetMinutes(tz, guess) * 60000; // second pass settles DST edges
  return guess;
}
export function fmtInZone(utcMs: number, tz: string): string {
  const d = localDate(utcMs, tz);
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(utcMs));
  return `${d} ${t}`;
}

// ── US blackout days (SKILL STEP 3) ────────────────────────────────────────
export function thanksgiving(y: number): string { return nthWeekday(y, 11, 4, 4); }

export function usBlackout(date: string): string | null {
  const y = Number(date.slice(0, 4));
  const md = date.slice(5);
  if (md >= "12-23" || md <= "01-01") return "US holidays (23 Dec to 1 Jan)";
  const tg = thanksgiving(y);
  if (date >= addDays(tg, -1) && date <= addDays(tg, 3)) return "Thanksgiving";
  if (date === nthWeekday(y, 1, 1, 3)) return "MLK Day";
  if (date === nthWeekday(y, 2, 1, 3)) return "Presidents Day";
  if (date === nthWeekday(y, 5, 1, -1)) return "Memorial Day";
  const jul4 = ymd(y, 7, 4);
  const jul4obs = weekday(jul4) === 6 ? addDays(jul4, -1) : weekday(jul4) === 0 ? addDays(jul4, 1) : jul4;
  if (date === jul4 || date === jul4obs) return "July 4";
  if (date === nthWeekday(y, 9, 1, 1)) return "Labor Day";
  return null;
}

export function isSendDay(date: string, allowWeekend: boolean): boolean {
  const wd = weekday(date);
  if (!allowWeekend && (wd === 0 || wd === 6)) return false;
  return usBlackout(date) === null;
}
/** Same day if it is a send day, otherwise the one before. */
export function prevSendDay(date: string, allowWeekend = false): string {
  let d = date;
  for (let i = 0; i < 30 && !isSendDay(d, allowWeekend); i++) d = addDays(d, -1);
  return d;
}

/** Same day if it is a send day, otherwise the next one. */
export function nextSendDay(date: string, allowWeekend = false): string {
  let d = date;
  for (let i = 0; i < 30 && !isSendDay(d, allowWeekend); i++) d = addDays(d, 1);
  return d;
}

// ── Lead time, bucket, decision deadline ───────────────────────────────────
export function bucketFor(leadDays: number | null): Bucket {
  if (leadDays === null) return "UNKNOWN";
  if (leadDays <= 28) return "ULTRA_SHORT";
  if (leadDays <= 90) return "SHORT";
  if (leadDays <= 180) return "MEDIUM";
  if (leadDays <= 365) return "LONG";
  return "VERY_LONG";
}

/** DD ≈ charter − 35 days (the MYBA balance + APA + VAT window). For very
 *  short leads: base + min(7, L − 3). */
export function decisionDeadline(baseDate: string, charterFrom: string | null): string | null {
  if (!charterFrom) return null;
  const L = daysBetween(baseDate, charterFrom);
  if (L < 40) return addDays(baseDate, Math.max(1, Math.min(7, L - 3)));
  return addDays(charterFrom, -35);
}

export type LeadFacts = {
  baseDate: string; // client-local day the proposal left (or today for a re-plan)
  charterFrom: string | null;
  L: number | null;
  bucket: Bucket;
  dd: string | null;
};
export function leadFacts(baseIso: string, charterFrom: string | null | undefined, tz: string): LeadFacts {
  const baseDate = localDate(Date.parse(baseIso), tz);
  const cf = charterFrom && /^\d{4}-\d{2}-\d{2}$/.test(charterFrom) ? charterFrom : null;
  const L = cf ? daysBetween(baseDate, cf) : null;
  return { baseDate, charterFrom: cf, L, bucket: bucketFor(L), dd: decisionDeadline(baseDate, cf) };
}

// ── The cadence (SKILL STEP 3, research §"Πρόγραμμα follow-up ανά lead time") ─
type Raw = { date: string; touch: TouchHint; anchor?: string; kind?: PlannedStep["kind"]; opening?: boolean; priority?: boolean };

const ULTRA: [number, TouchHint][] = [
  [0, "voice_note"], [1, "itinerary_idea"], [2, "availability_update"], [3, "availability_update"],
  [5, "no_oriented_question"], [7, "permission_to_close"],
];
const SHORT: [number, TouchHint][] = [
  [1, "photo_video"], [3, "crew_bio"], [8, "availability_update"], [14, "voice_note"],
  [17, "availability_update"], [22, "no_oriented_question"], [24, "forwardable_one_pager"], [29, "permission_to_close"],
];
const MEDIUM: [number, TouchHint][] = [
  [1, "photo_video"], [3, "itinerary_idea"], [7, "discovery_question"], [14, "availability_update"],
  [21, "photo_video"], [30, "testimonial"], [44, "availability_update"],
];
const MEDIUM_TAIL: TouchHint[] = ["no_oriented_question", "alternative_dates_or_yacht", "insider_tip", "availability_update"];
const LONG_START: [number, TouchHint][] = [[2, "voice_note"], [6, "discovery_question"], [13, "voice_note"]];
const UNKNOWN: [number, TouchHint][] = [
  [1, "discovery_question"], [3, "itinerary_idea"], [7, "one_click_question"], [14, "availability_update"],
  [21, "photo_video"], [30, "no_oriented_question"],
];

/** Market-event anchors for one calendar year (only true-in-the-calendar ones;
 *  early-booking only when the deadline is stored). */
function anchorsForYear(y: number, earlyBooking: string | null): Raw[] {
  const out: Raw[] = [
    { date: nthWeekday(y, 10, 2, 1), touch: "availability_update", anchor: `${y + 1} rate cards landing` },
    { date: addDays(thanksgiving(y), -2), touch: "holiday_greeting_no_ask", anchor: "Tuesday before Thanksgiving, warm, no ask" },
    { date: onOrAfter(ymd(y, 1, 2), 3), touch: "availability_update", anchor: "US planning window opens" },
    { date: addDays(nthWeekday(y, 2, 1, 3), 1), touch: "discovery_question", anchor: "after Presidents Day" },
    { date: onOrAfter(ymd(y, 3, 15), 2), touch: "availability_update", anchor: "mid-March real availability check" },
    { date: onOrAfter(ymd(y, 4, 12), 2), touch: "no_oriented_question", anchor: "mid-April, no-oriented question" },
    { date: onOrAfter(ymd(y, 5, 10), 2), touch: "alternative_dates_or_yacht", anchor: "May: June or September alternatives" },
    { date: onOrAfter(ymd(y, 6, 7), 2), touch: "photo_video", anchor: "the season is live" },
  ];
  if (earlyBooking && earlyBooking.slice(0, 4) === String(y)) {
    out.push({ date: addDays(earlyBooking, -21), touch: "early_booking_deadline", anchor: `early-booking deadline ${earlyBooking}` });
  }
  return out;
}

export type PlanInput = {
  sentAtIso: string;
  charterFrom: string | null | undefined;
  tz: string;
  earlyBookingDeadline?: string | null;
};

/** The full plan for a request whose proposal just left. Dates are client-
 *  local days, already moved off weekends (except ULTRA_SHORT) and US
 *  blackouts. The last step is always the honest close of the file. */
export function planFollowUps(input: PlanInput): PlannedStep[] {
  const f = leadFacts(input.sentAtIso, input.charterFrom, input.tz);
  const { baseDate, charterFrom, bucket, dd } = f;
  const weekendOk = bucket === "ULTRA_SHORT";
  const raw: Raw[] = [];
  const push = (offsets: [number, TouchHint][]) =>
    offsets.forEach(([o, t]) => raw.push({ date: addDays(baseDate, o), touch: t }));

  if (bucket === "ULTRA_SHORT") {
    push(ULTRA);
  } else if (bucket === "SHORT") {
    push(SHORT);
  } else if (bucket === "MEDIUM") {
    push(MEDIUM);
    let d = addDays(baseDate, 44 + 20), i = 0;
    while (dd && d < dd) { raw.push({ date: d, touch: MEDIUM_TAIL[i++ % MEDIUM_TAIL.length] }); d = addDays(d, 20); }
    if (dd) raw.push({ date: dd, touch: "permission_to_close", anchor: "decision deadline (MYBA payment window)", kind: "bye" });
  } else if (bucket === "LONG" || bucket === "VERY_LONG") {
    LONG_START.forEach(([o, t]) => raw.push({ date: addDays(baseDate, o), touch: t, opening: true }));
    const y0 = Number(baseDate.slice(0, 4));
    const y1 = Number((dd ?? baseDate).slice(0, 4));
    for (let y = y0; y <= y1; y++) raw.push(...anchorsForYear(y, input.earlyBookingDeadline ?? null));
    if (dd) {
      raw.push({ date: addDays(dd, -21), touch: "availability_update", anchor: "last call before the MYBA payment window", priority: true });
      raw.push({ date: dd, touch: "permission_to_close", anchor: "decision deadline: close the file or move to next season", kind: "bye" });
    }
  } else {
    push(UNKNOWN);
    raw.push({ date: addDays(baseDate, 45), touch: "permission_to_close", kind: "bye" });
  }

  // Order, move to real send days, apply the bucket's limits.
  raw.sort((a, b) => a.date.localeCompare(b.date));
  const stopAt = charterFrom ? addDays(charterFrom, bucket === "ULTRA_SHORT" ? -3 : -21) : null;
  const firstFour = bucket === "LONG" || bucket === "VERY_LONG" ? addDays(baseDate, 13) : null;
  const out: Raw[] = [];
  for (const r0 of raw) {
    const r: Raw = r0.touch === "permission_to_close" ? { ...r0, kind: "bye" } : r0;
    let date = nextSendDay(r.date, weekendOk);
    // The close never lands after the decision deadline: it moves back to the
    // last send day on or before it (acceptance test 1).
    if (r.kind === "bye" && dd && date > dd) {
      date = prevSendDay(dd, weekendOk);
    }
    if (r.kind === "bye") while (out.length && out[out.length - 1].date >= date) out.pop();
    if (date < baseDate) continue;
    // Market anchors start after the opening run (+2, +6, +13), never inside it.
    if (firstFour && r.anchor && r.kind !== "bye" && date <= firstFour) continue;
    if (bucket === "ULTRA_SHORT" && date === baseDate && r.touch !== "voice_note") continue;
    if (stopAt && date > stopAt && r.kind !== "bye") continue;
    if (dd && date > dd && r.kind !== "bye") continue; // nothing after the decision deadline but the close
    const prev = out.at(-1);
    if (prev && prev.date >= date) continue; // never two on one day, never out of order
    // LONG: after the first three, at most one per calendar month (SKILL
    // STEP 3) and never closer than a week to the touch before.
    if (firstFour && !r.opening && date > firstFour && prev) {
      if (r.kind !== "bye" && date.slice(0, 7) === prev.date.slice(0, 7)) {
        // The last call before the payment window outranks a calendar anchor.
        if (r.priority && !prev.opening) out.pop(); else continue;
      }
      if (r.kind !== "bye" && daysBetween(prev.date, date) < 7) continue;
      if (r.kind === "bye" && daysBetween(prev.date, date) < 7) out.pop();
    }
    out.push({ ...r, date });
  }
  // SHORT/ULTRA: if the deadline cut the planned close, the last step that
  // survived becomes the close (the file must be closed honestly).
  if (out.length && !out.some((r) => r.touch === "permission_to_close")) {
    out[out.length - 1] = { ...out[out.length - 1], touch: "permission_to_close", kind: "bye" };
  }
  if (out.length === 0) {
    out.push({ date: nextSendDay(addDays(baseDate, 1), true), touch: "permission_to_close", kind: "bye" });
  }
  return out.map((r) => ({
    due: r.date,
    done_at: null,
    how: null,
    kind: r.touch === "permission_to_close" ? "bye" : (r.kind ?? "nudge"),
    v: 2,
    touch: r.touch,
    ...(r.anchor ? { anchor: r.anchor } : {}),
  }));
}

/** GHOSTED (replied, then silent ≥ 3 days): +2, +5, +10, +20, +35 from the
 *  client's last message, then nurture. */
export function planGhosted(lastInboundIso: string, tz: string, todayIso: string): PlannedStep[] {
  const from = localDate(Date.parse(lastInboundIso), tz);
  const today = localDate(Date.parse(todayIso), tz);
  const seq: [number, TouchHint, PlannedStep["kind"]][] = [
    [2, "forwardable_one_pager", "nudge"], [5, "discovery_question", "nudge"], [10, "voice_note", "nudge"],
    [20, "all_in_cost_clarity", "nudge"], [35, "permission_to_close", "bye"],
  ];
  const out: PlannedStep[] = [];
  for (const [o, t, k] of seq) {
    let d = nextSendDay(addDays(from, o));
    if (d <= today) continue;
    if (out.length && d <= out.at(-1)!.due) d = nextSendDay(addDays(out.at(-1)!.due, 1));
    out.push({ due: d, done_at: null, how: null, kind: k, v: 2, touch: t });
  }
  if (!out.length) out.push({ due: nextSendDay(addDays(today, 2)), done_at: null, how: null, kind: "bye", v: 2, touch: "permission_to_close" });
  return out;
}

/** NURTURE (after the close): every 45–60 days, max 6 a year, value only;
 *  the nine-word question at 90 and 270 days. */
export function planNurture(fromIso: string, tz: string): PlannedStep[] {
  const from = localDate(Date.parse(fromIso), tz);
  const seq: [number, TouchHint, string][] = [
    [50, "journal_or_charter_index", "nurture: something useful, no ask"],
    [90, "one_click_question", "nurture: the nine-word question"],
    [140, "journal_or_charter_index", "nurture: something useful, no ask"],
    [195, "new_yacht", "nurture: real fleet news only"],
    [270, "one_click_question", "nurture: the nine-word question"],
  ];
  return seq.map(([o, t, a]) => ({ due: nextSendDay(addDays(from, o)), done_at: null, how: null, kind: "nudge" as const, v: 2 as const, touch: t, anchor: a }));
}

// ── Send windows (client local time) ───────────────────────────────────────
export type Channel = "email" | "whatsapp" | "imessage" | "call" | "voice_note";
const WINDOWS: Record<Channel, [string, string][]> = {
  email: [["08:30", "11:00"]],
  whatsapp: [["12:00", "13:30"], ["17:30", "19:00"]],
  imessage: [["12:00", "13:30"], ["17:30", "19:00"]],
  voice_note: [["12:00", "13:30"], ["17:30", "19:00"]],
  call: [["10:00", "12:00"], ["16:00", "17:30"]],
};

export type SendSlot = {
  client_local: string; // "YYYY-MM-DD HH:MM"
  athens: string;
  utc: string;
  window_client: string; // "08:30–11:00"
  window_athens: string;
  tz: string;
};

/** The earliest proper moment on or after `dueDate` (and not in the past). */
export function nextSendSlot(dueDate: string, channel: Channel, tz: string, nowMs: number, allowWeekend = false): SendSlot {
  const windows = WINDOWS[channel] ?? WINDOWS.email;
  let day = nextSendDay(dueDate < localDate(nowMs, tz) ? localDate(nowMs, tz) : dueDate, allowWeekend);
  for (let i = 0; i < 30; i++) {
    const callDayOk = channel !== "call" || [2, 3, 4].includes(weekday(day)) || allowWeekend;
    if (callDayOk) {
      for (const [a, b] of windows) {
        const start = zonedToUtc(day, a, tz);
        const end = zonedToUtc(day, b, tz);
        if (end > nowMs) {
          const at = Math.max(start, nowMs);
          return {
            client_local: fmtInZone(at, tz),
            athens: fmtInZone(at, "Europe/Athens"),
            utc: new Date(at).toISOString(),
            window_client: `${a}–${b}`,
            window_athens: `${fmtInZone(start, "Europe/Athens").slice(11)}–${fmtInZone(end, "Europe/Athens").slice(11)}`,
            tz,
          };
        }
      }
    }
    day = nextSendDay(addDays(day, 1), allowWeekend);
  }
  const at = zonedToUtc(day, windows[0][0], tz);
  return { client_local: fmtInZone(at, tz), athens: fmtInZone(at, "Europe/Athens"), utc: new Date(at).toISOString(), window_client: windows[0].join("–"), window_athens: "", tz };
}

// ── Client time zone: stored, or inferred from the phone ───────────────────
const AREA: Record<string, string> = {};
const put = (tz: string, codes: string) => codes.split(" ").forEach((c) => (AREA[c] = tz));
put("America/Los_Angeles", "209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951 206 253 360 425 509 564 458 503 541 971 702 725 775");
put("America/Phoenix", "480 520 602 623 928");
put("America/Denver", "303 719 720 970 983 385 435 801 505 575 208 986 406 307");
put("America/Chicago", "210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979 217 224 309 312 331 447 464 618 630 708 773 779 815 847 872 218 320 507 612 651 763 952 314 417 557 573 636 660 816 975 262 274 414 534 608 715 920 225 318 337 504 985 405 539 572 580 918 316 620 785 913 308 402 531 319 515 563 641 712 479 501 870 228 601 662 769 205 251 256 334 659 938 731 901 701 605");
put("Pacific/Honolulu", "808");
put("America/Anchorage", "907");

const COUNTRY_TZ: Record<string, string> = {
  "44": "Europe/London", "353": "Europe/Dublin", "33": "Europe/Paris", "49": "Europe/Berlin", "41": "Europe/Zurich",
  "39": "Europe/Rome", "34": "Europe/Madrid", "31": "Europe/Amsterdam", "32": "Europe/Brussels", "30": "Europe/Athens",
  "971": "Asia/Dubai", "966": "Asia/Riyadh", "972": "Asia/Jerusalem", "61": "Australia/Sydney", "65": "Asia/Singapore",
  "852": "Asia/Hong_Kong", "55": "America/Sao_Paulo", "52": "America/Mexico_City",
};

export type TzChoice = { tz: string; source: "stored" | "phone" | "default" };

export function clientTimezone(stored: string | null | undefined, phone: string | null | undefined): TzChoice {
  if (stored && isValidTz(stored)) return { tz: stored, source: "stored" };
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  const intl = digits.startsWith("+") ? digits.slice(1) : digits.startsWith("00") ? digits.slice(2) : null;
  if (intl) {
    if (intl.startsWith("1") && intl.length >= 11) {
      return { tz: AREA[intl.slice(1, 4)] ?? "America/New_York", source: "phone" };
    }
    for (const len of [3, 2]) {
      const tz = COUNTRY_TZ[intl.slice(0, len)];
      if (tz) return { tz, source: "phone" };
    }
  } else if (digits.length === 10 && AREA[digits.slice(0, 3)]) {
    return { tz: AREA[digits.slice(0, 3)], source: "phone" };
  }
  return { tz: "America/New_York", source: "default" };
}

export function isValidTz(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export const TZ_CHOICES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Paris", "Europe/Athens", "Asia/Dubai", "Australia/Sydney",
];


// ── 16/11 (George): the plan follows the conversation, on every channel ────
// "μπορεί να μιλήσω με κάποιο πελάτη το βράδυ και να μην πρέπει να τον κάνω
// follow-up αύριο, και μετά πρέπει να αλλάζουν και τα επόμενα". Pure: the
// server feeds it the facts read from Gmail + WhatsApp + iMessage + notes.

type AnyStep = { due: string; done_at: string | null; how: string | null; kind?: "nudge" | "reopen" | "bye"; manual?: boolean; anchor?: string; touch?: string; v?: 2 };

export type ConversationFacts = {
  todayIso: string;
  tz: string;
  charterFrom: string | null;
  sentAtIso: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null; // George, any channel
  hadInboundAfterFirstOut: boolean;
  ball: "client_owes" | "we_owe" | "none";
  clientFollowupDate: string | null;
  // 17/11: does the client's LAST message actually need an answer? "Thank
  // you, let me look at the email" does not: the ball is with the client.
  // null = unknown (treated as needing an answer).
  lastInboundNeedsReply?: boolean | null;
};

// After a client acknowledges ("thanks, I'll look at it"), give them room.
const ACK_GAP: Record<Bucket, number> = { ULTRA_SHORT: 1, SHORT: 4, MEDIUM: 6, LONG: 7, VERY_LONG: 7, UNKNOWN: 5 };

const MIN_SPACING: Record<Bucket, number> = { ULTRA_SHORT: 1, SHORT: 2, MEDIUM: 3, LONG: 3, VERY_LONG: 3, UNKNOWN: 3 };

const MIN_GAP: Record<Bucket, number> = { ULTRA_SHORT: 1, SHORT: 2, MEDIUM: 3, LONG: 5, VERY_LONG: 5, UNKNOWN: 3 };

export function rescheduleFromConversation<T extends AnyStep>(fu: T[], f: ConversationFacts): { fu: AnyStep[]; reason: string; changed: boolean } {
  const today = localDate(Date.parse(f.todayIso), f.tz);
  const facts = leadFacts(f.sentAtIso, f.charterFrom, f.tz);
  const weekendOk = facts.bucket === "ULTRA_SHORT";
  const done = fu.filter((s) => s.done_at);
  const pending = fu.filter((s) => !s.done_at);
  const manual = pending.filter((s) => s.manual && s.due >= today);
  let auto: AnyStep[] = pending.filter((s) => !s.manual);
  let reason = "";
  const lastOutDay = f.lastOutboundAt ? localDate(Date.parse(f.lastOutboundAt), f.tz) : null;
  const lastInDay = f.lastInboundAt ? localDate(Date.parse(f.lastInboundAt), f.tz) : null;

  // The research plan for this lead; after any reset (an agreed day, an
  // answer owed, an acknowledgment) the plan carries on from it, a week on.
  const research = (): AnyStep[] => planFollowUps({ sentAtIso: f.sentAtIso, charterFrom: f.charterFrom, tz: f.tz });
  if (f.clientFollowupDate && f.clientFollowupDate >= today) {
    // The client (or George) set the day: nothing before it.
    const first = nextSendDay(f.clientFollowupDate, weekendOk);
    const rest = research().filter((s) => s.due > addDays(first, 6));
    auto = [{ due: first, done_at: null, how: null, kind: "nudge", v: 2, touch: "availability_update", anchor: "η μέρα που συμφωνήσατε" }, ...rest];
    reason = `συμφωνημένη μέρα ${first}`;
  } else if (f.ball === "we_owe" && lastInDay && f.lastInboundNeedsReply === false) {
    // The client acknowledged and will come back: no chasing. One calm touch
    // after a real pause, then the research plan carries on from there.
    const first = nextSendDay(addDays(lastInDay, ACK_GAP[facts.bucket]), weekendOk);
    // After that touch: the research plan for this lead (market anchors, the
    // close at the decision deadline), not leftovers of an earlier chase.
    const rest: AnyStep[] = research().filter((s) => s.due > addDays(first, 6));
    auto = [{ due: first, done_at: null, how: null, kind: "nudge", v: 2, anchor: "ο πελάτης είπε ότι θα το δει: δώσ' του χρόνο" }, ...rest];
    reason = `ο πελάτης απάντησε (${lastInDay}) ότι θα το δει: επόμενη επαφή ${first}`;
  } else if (f.ball === "we_owe" && lastInDay) {
    // The client wrote and it needs an answer: the answer is today. No
    // follow-ups stacked behind it (17/11, Erika Varcak: "they're 14 and 15"
    // got today + tomorrow + the 23rd). Once George answers, the plan is
    // re-timed from his answer; until then only the research plan, a week on.
    const rest = research().filter((s) => s.due > addDays(today, ACK_GAP[facts.bucket]));
    auto = [{ due: nextSendDay(today, true), done_at: null, how: null, kind: "nudge", v: 2, anchor: "ο πελάτης έγραψε: χρωστάς απάντηση" }, ...rest];
    reason = "ο πελάτης έγραψε τελευταίος";
  } else if (f.hadInboundAfterFirstOut && lastInDay && daysBetween(lastInDay, today) <= 35) {
    // They talked, then went quiet: +2/+5/+10/+20/+35 from THEIR last word,
    // never sooner than two days after George's last message.
    const floor = lastOutDay ? addDays(lastOutDay, 2) : today;
    let ladder: AnyStep[] = planGhosted(f.lastInboundAt!, f.tz, f.todayIso).map((s) => (s.due < floor ? { ...s, due: nextSendDay(floor) } : s));
    // A summer charter a year away is not closed in December: for long leads
    // the +35 close becomes a plain touch and the market anchors carry on.
    if ((facts.bucket === "LONG" || facts.bucket === "VERY_LONG") && facts.dd && daysBetween(today, facts.dd) > 90) {
      ladder = ladder.map((s) => (s.kind === "bye" ? { ...s, kind: "nudge" as const, touch: "no_oriented_question" } : s));
      const lastLadder = ladder.at(-1)?.due ?? today;
      ladder = [...ladder, ...auto.filter((s) => s.due > lastLadder)];
    }
    auto = ladder;
    reason = `σιωπή μετά από συζήτηση (τελευταίο μήνυμα πελάτη ${lastInDay})`;
  } else {
    // Never replied, or went quiet long ago (the +2…+35 ladder has run its
    // course): keep the research plan with its market anchors, but nothing
    // sooner than the minimum gap after George's last touch on ANY channel.
    const floor = [today, lastOutDay ? addDays(lastOutDay, MIN_GAP[facts.bucket]) : today].sort().at(-1)!;
    auto = auto.map((s) => (s.due < floor ? { ...s, due: nextSendDay(floor, weekendOk) } : s));
    reason = lastOutDay ? `τελευταία δική σου επαφή ${lastOutDay}` : "";
  }

  // Merge George's own dates back in, then make the order strict. An
  // automatic step within a few days of a date George set by hand gives way
  // to his (17/11, Anderson: auto 1/12 beside his own 2/12).
  const near = (a: string, b: string) => Math.abs(daysBetween(a, b)) < 4;
  auto = auto.filter((s) => s.kind === "bye" || !manual.some((m) => near(m.due, s.due)));
  const merged = [...auto, ...manual].sort((a, b) => a.due.localeCompare(b.due));
  const out: AnyStep[] = [];
  const spacing = MIN_SPACING[facts.bucket];
  for (const s of merged) {
    let due = s.due;
    const prev = out.at(-1);
    // Never two touches on top of each other (19/4 then 20/4).
    if (prev && !s.manual && daysBetween(prev.due, due) < spacing) due = nextSendDay(addDays(prev.due, spacing), weekendOk);
    else if (prev && due <= prev.due) due = nextSendDay(addDays(prev.due, 1), weekendOk);
    out.push({ ...s, due });
  }
  // One close, and it stays last (older plans could carry two).
  const byes = out.filter((s) => s.kind === "bye");
  if (byes.length > 1) {
    const keep = byes[byes.length - 1];
    for (let i = out.length - 1; i >= 0; i--) if (out[i].kind === "bye" && out[i] !== keep && !out[i].manual) out.splice(i, 1);
  }
  const byeIdx = out.findIndex((s) => s.kind === "bye");
  if (byeIdx >= 0 && byeIdx < out.length - 1) {
    const [bye] = out.splice(byeIdx, 1);
    out.push({ ...bye, due: nextSendDay(addDays(out.at(-1)!.due, 3), weekendOk) });
  }
  const next = [...done, ...out];
  const changed = JSON.stringify(pending.map((s) => s.due)) !== JSON.stringify(out.map((s) => s.due));
  return { fu: next, reason, changed };
}
