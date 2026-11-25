// src/lib/aftersales/dates.ts — plain YYYY-MM-DD arithmetic, Athens calendar.

const DAY = 86400000;

export function athensToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return new Date(d.getTime() + n * DAY).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10) + "T00:00:00Z") - Date.parse(a.slice(0, 10) + "T00:00:00Z")) / DAY);
}
/** Same month and day in another year; 29 Feb falls back to 28 Feb. */
export function sameDayInYear(iso: string, year: number): string {
  const mm = iso.slice(5, 7);
  let dd = iso.slice(8, 10);
  if (mm === "02" && dd === "29") {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (!leap) dd = "28";
  }
  return `${year}-${mm}-${dd}`;
}
/** US Thanksgiving: the fourth Thursday of November. */
export function thanksgiving(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1));
  const offset = (4 - first.getUTCDay() + 7) % 7; // 4 = Thursday
  return new Date(Date.UTC(year, 10, 1 + offset + 21)).toISOString().slice(0, 10);
}
export function fmtLong(iso: string): string {
  return new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("el-GR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
/** Whole years between a date of birth and a day. */
export function ageOn(dob: string, day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  let age = Number(day.slice(0, 4)) - Number(dob.slice(0, 4));
  if (day.slice(5, 10) < dob.slice(5, 10)) age -= 1;
  return age;
}
