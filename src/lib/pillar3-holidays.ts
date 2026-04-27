// Pillar 3 — variable-date holiday calculator.
//
// Pure functions. Year in, list of holidays out. Used by the nightly
// /api/cron/inbox-greetings job to decide which contacts to draft for.
//
// Coverage (per refocus brief):
//   - Western Easter (Gregorian computus)
//   - Orthodox Easter (Julian computus, then convert to Gregorian)
//   - Eid al-Fitr        (Islamic calendar, end of Ramadan)
//   - Eid al-Adha        (Islamic calendar, 10th of Dhu al-Hijjah)
//   - Diwali             (Hindu calendar, 15th of Kartik)
//   - Hanukkah           (Hebrew calendar, 25 Kislev — first night)
//
// Algorithms:
//   - Easter dates: Anonymous Gregorian / Julian algorithm.
//   - Islamic / Hindu / Hebrew: cached table of dates 2025-2030 since
//     a full calendar conversion library is excessive for our use
//     case. Extend the table when the time horizon expires.

export interface HolidayDate {
  kind:
    | "western_easter"
    | "orthodox_easter"
    | "eid_al_fitr"
    | "eid_al_adha"
    | "diwali"
    | "hanukkah_first_night";
  date: string; // ISO YYYY-MM-DD
}

// ─── Easter via Anonymous Gregorian Algorithm ──────────────────────
function gregorianEaster(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

// ─── Orthodox Easter (Julian computus → Gregorian conversion) ─────
function orthodoxEaster(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = year % 7;
  const c = year % 4;
  const d = (19 * a + 16) % 30;
  const e = (2 * c + 4 * b + 6 * d) % 7;
  // Julian Easter offset from March 22
  const julianDay = 22 + d + e;
  // Convert to Gregorian: add 13 days (correct for years 1900-2099)
  const gregorianOffset = 13;
  let month = 3;
  let day = julianDay + gregorianOffset;
  if (day > 31) {
    day -= 31;
    month = 4;
    if (day > 30) {
      day -= 30;
      month = 5;
    }
  }
  return { month, day };
}

// ─── Hard-coded variable holidays for years we care about ─────────
// Sources: timeanddate.com cross-checked with Hijri/Hindu/Hebrew
// calendars. Update when years run out.
const FIXED_TABLE: Record<number, Partial<Record<HolidayDate["kind"], string>>> = {
  2025: {
    eid_al_fitr: "2025-03-30",
    eid_al_adha: "2025-06-06",
    diwali: "2025-10-21",
    hanukkah_first_night: "2025-12-14",
  },
  2026: {
    eid_al_fitr: "2026-03-20",
    eid_al_adha: "2026-05-27",
    diwali: "2026-11-08",
    hanukkah_first_night: "2026-12-04",
  },
  2027: {
    eid_al_fitr: "2027-03-09",
    eid_al_adha: "2027-05-16",
    diwali: "2027-10-29",
    hanukkah_first_night: "2027-12-24",
  },
  2028: {
    eid_al_fitr: "2028-02-26",
    eid_al_adha: "2028-05-05",
    diwali: "2028-11-17",
    hanukkah_first_night: "2028-12-12",
  },
  2029: {
    eid_al_fitr: "2029-02-14",
    eid_al_adha: "2029-04-24",
    diwali: "2029-11-05",
    hanukkah_first_night: "2029-12-02",
  },
  2030: {
    eid_al_fitr: "2030-02-04",
    eid_al_adha: "2030-04-13",
    diwali: "2030-10-26",
    hanukkah_first_night: "2030-12-21",
  },
};

function fmt(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function variableHolidaysForYear(year: number): HolidayDate[] {
  const out: HolidayDate[] = [];
  const we = gregorianEaster(year);
  out.push({ kind: "western_easter", date: fmt(year, we.month, we.day) });
  const oe = orthodoxEaster(year);
  out.push({ kind: "orthodox_easter", date: fmt(year, oe.month, oe.day) });
  const tbl = FIXED_TABLE[year];
  if (tbl) {
    if (tbl.eid_al_fitr) out.push({ kind: "eid_al_fitr", date: tbl.eid_al_fitr });
    if (tbl.eid_al_adha) out.push({ kind: "eid_al_adha", date: tbl.eid_al_adha });
    if (tbl.diwali) out.push({ kind: "diwali", date: tbl.diwali });
    if (tbl.hanukkah_first_night)
      out.push({
        kind: "hanukkah_first_night",
        date: tbl.hanukkah_first_night,
      });
  }
  return out;
}

// ─── Fixed-date holidays per religion / country ───────────────────

export const FIXED_GREETING_HOLIDAYS = [
  // Universal Christmas — for catholic + protestant + unknown-Western
  {
    kind: "western_christmas",
    month: 12,
    day: 25,
    religions: ["catholic", "protestant", "unknown"],
  },
  // Orthodox Christmas — for orthodox
  {
    kind: "orthodox_christmas",
    month: 1,
    day: 7,
    religions: ["orthodox"],
  },
  // US Independence Day — for US contacts (especially charter clients)
  {
    kind: "us_independence_day",
    month: 7,
    day: 4,
    countries: ["US", "United States"],
  },
  // Greek Independence Day — for Greek contacts
  {
    kind: "greek_independence_day",
    month: 3,
    day: 25,
    countries: ["GR", "Greece"],
  },
] as const;

// Map a holiday kind to which religions it should be sent to. Variable
// holidays (Easter etc) need this too, since the variable date alone
// doesn't say "send to whom".
export const HOLIDAY_RELIGION_MAP: Record<string, string[]> = {
  western_easter: ["catholic", "protestant"],
  orthodox_easter: ["orthodox"],
  eid_al_fitr: ["muslim"],
  eid_al_adha: ["muslim"],
  diwali: ["hindu"],
  hanukkah_first_night: ["jewish"],
  western_christmas: ["catholic", "protestant", "unknown"],
  orthodox_christmas: ["orthodox"],
};
