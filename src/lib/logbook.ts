// THE LOGBOOK: how the site did, day by day, with the history kept.
//
// George, 6/11/2026: "inside the Command Center, near The Helm, The
// Lighthouse and The Cabin: the real visitors, our position on Google,
// a chart of what happened each day, so I can see at a glance how
// yesterday went, and it keeps the whole history and adds it up every
// month."
//
// Two sources, neither counted here:
//
// 1. VISITORS come from the website's own feed
//    (georgeyachts.com/api/logbook/days). The site decides who is a person
//    and who is a machine with the same rule that builds the morning
//    email, so this page and that email can never disagree about a day.
//    The Command Center could not count them itself anyway: since the
//    database move of 4/6/2026 the site's tracker writes visits to its
//    own database, not to this one (the old Visitors page has shown
//    nothing new since 3/6).
//
// 2. GOOGLE comes straight from Search Console, with George's own Google
//    account (the same token the Monday numbers use).
//
// What is stored (settings table, no new tables):
//   logbook_index         every day's counts + each month's unique people
//   logbook_day_<date>    the full record of one day (who, from where, what)
//   logbook_gsc           every day Search Console still remembers
//   logbook_gsc_queries   the last 28 days of queries against the 28 before
//
// A logbook day is 24 hours from 05:00 UTC (07:00 in Athens in winter,
// midnight in New York), named by the date it starts: the email's day.

import { createServiceClient } from "./supabase-server";
import { getAccessToken } from "./google-api";

const PREFIX = process.env.LOGBOOK_KEY_PREFIX || "logbook";
const SITE_URL = (process.env.LOGBOOK_SITE_URL || "https://georgeyachts.com").replace(/\/$/, "");
const GSC_SITE = "sc-domain:georgeyachts.com";
const DAY_MS = 24 * 60 * 60 * 1000;

// The tracker has recorded network and browser details since this day;
// before it a person cannot be told from a machine.
export const LOGBOOK_FIRST_DAY = "2026-05-15";

export type DayCounts = {
  people: number;
  us: number;
  engaged: number;
  yachtViewers: number;
  hot: number;
  requests: number;
  machines: number;
  mobile: number;
  returning: number;
  longStay: number;
  ai: number;
  google: number;
  direct: number;
};

export type TopVisitor = {
  place: string;
  at: string;
  tz: string | null;
  source: string;
  device: string;
  returning: boolean;
  hot: boolean;
  time: number;
  visits: number;
  pageCount: number;
  pages: string[];
  yachts: string[];
  tools: string[];
  cta: string | null;
  network: string;
};

export type DaySnapshot = {
  date: string;
  counts: DayCounts;
  sources: { name: string; n: number; ai: boolean }[];
  countries: [string, number][];
  usPlaces: [string, number][];
  yachts: [string, number][];
  landing: [string, number][];
  read: [string, number][];
  googleLanding: [string, number][];
  machinesBy: [string, number][];
  // From The Helm (see helmRequestsBetween). `id` opens the request.
  requests: { at: number; label: string; id?: string }[];
  top: TopVisitor[];
};

export type LogbookIndex = {
  updated_at: string;
  days: Record<string, DayCounts>;
  // Different people in the month so far (a sum of days counts a person
  // who came on two days twice; this does not).
  months: Record<string, { people: number; us: number; through: string }>;
};

// [clicks, impressions, average position, US clicks, US impressions, US position]
export type GscDay = [number, number, number, number, number, number];
export type LogbookGsc = {
  updated_at: string;
  // Search Console revises the last two or three days. Up to this date
  // the numbers are final.
  final_through: string | null;
  days: Record<string, GscDay>;
};

export type GscQuery = {
  q: string;
  clicks: number;
  impressions: number;
  position: number;
  prevClicks: number | null;
  prevImpressions: number | null;
  prevPosition: number | null;
};
export type LogbookQueries = {
  updated_at: string;
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  rows: GscQuery[];
};

const key = (name: string) => `${PREFIX}_${name}`;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => isoDate(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS);

// The latest day that has ended: day D ends at 05:00 UTC on D+1.
export function lastFinishedDay(nowMs = Date.now()): string {
  return isoDate(nowMs - 29 * 60 * 60 * 1000);
}

async function readJson<T>(name: string): Promise<T | null> {
  const sb = createServiceClient();
  const { data } = await sb.from("settings").select("value").eq("key", key(name)).maybeSingle();
  if (!data?.value) return null;
  try {
    return JSON.parse(data.value as string) as T;
  } catch {
    return null;
  }
}

async function writeJson(rows: { name: string; value: unknown }[]): Promise<void> {
  if (!rows.length) return;
  const sb = createServiceClient();
  const now = new Date().toISOString();
  const { error } = await sb
    .from("settings")
    .upsert(
      rows.map((r) => ({ key: key(r.name), value: JSON.stringify(r.value), updated_at: now })),
      { onConflict: "key" },
    );
  if (error) throw new Error(`settings write failed: ${error.message}`);
}

// ── Requests: The Helm ───────────────────────────────────────────
// 6/11/2026, the same evening the page went live. George looked at the
// months and said the requests could not be right: August the same as
// October, May above both. He was right. The first version took the
// requests from the website's feed, which counts the notes two of the
// site's forms leave in the site's own database: July showed 6 where The
// Helm holds 23, August 13 where it holds 35. A request is what is in The
// Helm, however it arrived (a form, an email, WhatsApp, a travel agent),
// so that is where the Logbook now reads them, and the morning email asks
// for the same list (/api/hooks/logbook-requests).
//
// The Helm opened on 30/5/2026; before that day there is nothing to count.
export const HELM_FIRST_DAY = "2026-05-30";

export type HelmRequestLine = { id: string; at: number; label: string };

const TEST_NAME = /\(TEST\)|\btest\b|\be2e\b/i;
const TEST_EMAIL = /test\+|@example\.com$|^george@georgeyachts\.com$/i;

export async function helmRequestsBetween(sinceIso: string, untilIso: string): Promise<HelmRequestLine[]> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("helm_requests")
    .select("id, created_at, client_name, client_email, request_type")
    .gte("created_at", sinceIso)
    .lt("created_at", untilIso)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`helm_requests read failed: ${error.message}`);
  return (data || [])
    .filter((r) => !TEST_NAME.test(String(r.client_name || "")) && !TEST_EMAIL.test(String(r.client_email || "").trim()))
    .map((r) => ({
      id: String(r.id),
      at: Date.parse(String(r.created_at)),
      label: `${String(r.client_name || "").trim() || "Χωρίς όνομα"}${r.request_type === "travel_agent" ? " (ταξιδιωτικό γραφείο)" : ""}`,
    }));
}

// A logbook day runs from 05:00 UTC on its date.
const dayStartMs = (date: string) => Date.parse(`${date}T05:00:00Z`);

// ── Visitors: ask the website ────────────────────────────────────
async function pullSiteDays(from: string, to: string): Promise<{ days: DaySnapshot[]; unique: { people: number; us: number } }> {
  // The secret the site and the CRM already share (the inquiry hook
  // uses it in the other direction).
  const secret = process.env.LOGBOOK_SITE_SECRET || process.env.NEWSLETTER_PROXY_SECRET;
  if (!secret) throw new Error("no shared secret for the website feed");
  const res = await fetch(`${SITE_URL}/api/logbook/days?from=${from}&to=${to}`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
    signal: AbortSignal.timeout(50000),
  });
  if (!res.ok) throw new Error(`website feed answered ${res.status} for ${from}..${to}`);
  const body = await res.json();
  if (!body?.ok || !Array.isArray(body.days)) throw new Error("website feed returned no days");
  return { days: body.days as DaySnapshot[], unique: body.unique || { people: 0, us: 0 } };
}

function monthBounds(ym: string, lastDay: string): { from: string; to: string } | null {
  const first = `${ym}-01`;
  const [y, m] = ym.split("-").map(Number);
  const end = isoDate(Date.UTC(y, m, 0));
  const from = first < LOGBOOK_FIRST_DAY ? LOGBOOK_FIRST_DAY : first;
  const to = end > lastDay ? lastDay : end;
  return from <= to ? { from, to } : null;
}

function monthsBetween(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  let [y, m] = fromDay.slice(0, 7).split("-").map(Number);
  const last = toDay.slice(0, 7);
  for (let i = 0; i < 240; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym > last) break;
    out.push(ym);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// Pulls whole months from the website and stores them. By default the
// month of the last finished day, plus the month before it during the
// first three days of a month (late-arriving details settle).
export async function refreshVisitors(opts: { backfill?: boolean; months?: string[] } = {}): Promise<{ months: string[]; days: number; last: string | null }> {
  const lastDay = lastFinishedDay();
  let months = opts.months;
  if (!months?.length) {
    if (opts.backfill) months = monthsBetween(LOGBOOK_FIRST_DAY, lastDay);
    else {
      months = [lastDay.slice(0, 7)];
      if (Number(lastDay.slice(8, 10)) <= 3) months.unshift(addDays(`${months[0]}-01`, -1).slice(0, 7));
    }
  }

  const index: LogbookIndex = (await readJson<LogbookIndex>("index")) || { updated_at: "", days: {}, months: {} };
  let stored = 0;
  let last: string | null = null;
  for (const ym of months) {
    const span = monthBounds(ym, lastDay);
    if (!span) continue;
    const { days, unique } = await pullSiteDays(span.from, span.to);
    // The requests of each day come from The Helm, not from the feed.
    if (days.length) {
      const helm = await helmRequestsBetween(
        new Date(dayStartMs(days[0].date)).toISOString(),
        new Date(dayStartMs(days[days.length - 1].date) + DAY_MS).toISOString(),
      );
      for (const d of days) {
        const from = dayStartMs(d.date);
        d.requests = helm.filter((r) => r.at >= from && r.at < from + DAY_MS).map((r) => ({ at: r.at, label: r.label, id: r.id }));
        d.counts.requests = d.requests.length;
      }
    }
    await writeJson(days.map((d) => ({ name: `day_${d.date}`, value: d })));
    for (const d of days) {
      index.days[d.date] = d.counts;
      stored += 1;
      if (!last || d.date > last) last = d.date;
    }
    if (days.length) index.months[ym] = { people: unique.people, us: unique.us, through: days[days.length - 1].date };
  }
  index.updated_at = new Date().toISOString();
  await writeJson([{ name: "index", value: index }]);
  return { months, days: stored, last };
}

// ── Google: ask Search Console ───────────────────────────────────
type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

async function gscQuery(token: string, body: Record<string, unknown>): Promise<GscRow[]> {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok) throw new Error(`Search Console answered ${res.status}`);
  const j = await res.json();
  return (j.rows || []) as GscRow[];
}

const US_ONLY = [{ filters: [{ dimension: "country", operator: "equals", expression: "usa" }] }];
const round1 = (n: number) => Math.round(n * 10) / 10;

export async function refreshGoogle(): Promise<{ days: number; last: string | null; queries: number }> {
  const token = await getAccessToken();
  const today = isoDate(Date.now());
  // Search Console keeps 16 months.
  const start = isoDate(Date.now() - 485 * DAY_MS);
  const [all, us, fin] = await Promise.all([
    gscQuery(token, { startDate: start, endDate: today, dimensions: ["date"], dataState: "all", rowLimit: 1000 }),
    gscQuery(token, { startDate: start, endDate: today, dimensions: ["date"], dataState: "all", rowLimit: 1000, dimensionFilterGroups: US_ONLY }),
    gscQuery(token, { startDate: isoDate(Date.now() - 12 * DAY_MS), endDate: today, dimensions: ["date"], dataState: "final", rowLimit: 30 }),
  ]);
  if (!all.length) throw new Error("Search Console returned no days");

  const usBy = new Map(us.map((r) => [r.keys[0], r]));
  // Keep what was stored before: once Search Console forgets a day (16
  // months on), the logbook still has it.
  const prev = await readJson<LogbookGsc>("gsc");
  const days: Record<string, GscDay> = { ...(prev?.days || {}) };
  // Search Console also returns the day still in progress. A half day
  // next to whole ones reads as a collapse, so it waits until its
  // logbook day has closed.
  const lastDay = lastFinishedDay();
  const closed = all.filter((r) => r.keys[0] <= lastDay);
  if (!closed.length) throw new Error("Search Console returned no finished days");
  for (const d of Object.keys(days)) if (d > lastDay) delete days[d];
  for (const r of closed) {
    const u = usBy.get(r.keys[0]);
    days[r.keys[0]] = [r.clicks, r.impressions, round1(r.position), u?.clicks || 0, u?.impressions || 0, u ? round1(u.position) : 0];
  }
  const last = closed[closed.length - 1].keys[0];
  const gsc: LogbookGsc = {
    updated_at: new Date().toISOString(),
    final_through: fin.length ? fin[fin.length - 1].keys[0] : null,
    days,
  };

  // Queries: the last 28 days against the 28 before them.
  const end = last;
  const qStart = addDays(end, -27);
  const prevEnd = addDays(qStart, -1);
  const prevStart = addDays(prevEnd, -27);
  const [now, before] = await Promise.all([
    gscQuery(token, { startDate: qStart, endDate: end, dimensions: ["query"], dataState: "all", rowLimit: 250 }),
    gscQuery(token, { startDate: prevStart, endDate: prevEnd, dimensions: ["query"], dataState: "all", rowLimit: 1000 }),
  ]);
  const beforeBy = new Map(before.map((r) => [r.keys[0], r]));
  const rows: GscQuery[] = now
    .map((r) => {
      const b = beforeBy.get(r.keys[0]);
      return {
        q: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        position: round1(r.position),
        prevClicks: b ? b.clicks : null,
        prevImpressions: b ? b.impressions : null,
        prevPosition: b ? round1(b.position) : null,
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 60);
  const queries: LogbookQueries = { updated_at: gsc.updated_at, start: qStart, end, prevStart, prevEnd, rows };

  await writeJson([
    { name: "gsc", value: gsc },
    { name: "gsc_queries", value: queries },
  ]);
  return { days: closed.length, last, queries: rows.length };
}

// ── Read (the page) ──────────────────────────────────────────────
export async function readDay(date: string): Promise<DaySnapshot | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return readJson<DaySnapshot>(`day_${date}`);
}

export type LogbookData = {
  index: LogbookIndex | null;
  gsc: LogbookGsc | null;
  queries: LogbookQueries | null;
  latest: DaySnapshot | null;
};

// Search Console keeps counting a day for hours after it ends, and the
// morning refresh runs early. So when George opens the page and the
// stored Google numbers are more than three hours old, they are fetched
// again first. If that fails the page shows what it has.
const GOOGLE_STALE_MS = 3 * 60 * 60 * 1000;

export async function loadLogbook(): Promise<LogbookData> {
  try {
    const stored = await readJson<LogbookGsc>("gsc");
    const age = stored?.updated_at ? Date.now() - Date.parse(stored.updated_at) : Infinity;
    if (stored && age > GOOGLE_STALE_MS) await refreshGoogle();
  } catch (e) {
    console.error("logbook: Google refresh on open failed:", e instanceof Error ? e.message : e);
  }
  const [index, gsc, queries] = await Promise.all([
    readJson<LogbookIndex>("index"),
    readJson<LogbookGsc>("gsc"),
    readJson<LogbookQueries>("gsc_queries"),
  ]);
  const dates = Object.keys(index?.days || {}).sort();
  const latest = dates.length ? await readDay(dates[dates.length - 1]) : null;
  return { index, gsc, queries, latest };
}
