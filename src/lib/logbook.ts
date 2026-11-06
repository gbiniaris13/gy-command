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
// The first month counted from its first day to its last.
export const LOGBOOK_FIRST_FULL_MONTH = "2026-06-01";

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

export type MonthRecord = {
  people: number;
  us: number;
  // Different people an AI assistant sent (ChatGPT, Perplexity, Copilot,
  // Gemini, Claude and the like). A floor: an assistant that opens the
  // link without leaving a trace cannot be counted.
  ai?: number;
  // Different people who arrived from a Google search (people, not clicks).
  google?: number;
  // Different people each assistant sent.
  aiBy?: [string, number][];
  through: string;
  // How many visits opened each yacht's page in the month.
  yachts?: [string, number][];
  // Only for the month still running: the same counts over the same days
  // of the month before, so "up or down" compares like with like.
  prevSame?: { people: number; us: number; ai: number; through: string };
};

export type LogbookIndex = {
  updated_at: string;
  days: Record<string, DayCounts>;
  // Different people in the month so far (a sum of days counts a person
  // who came on two days twice; this does not).
  months: Record<string, MonthRecord>;
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

// One request per person (George, 6/11: "για κάθε mail ένα αίτημα"),
// with one exception he spelled out the same evening: "αν είχε κλείσει
// ναύλο και ξαναήρθε, μετράει ως νέο αίτημα, σαν repeater. Αν δεν είχε
// κλείσει και ήρθε πάλι για να συνεχίσουμε, είναι το ίδιο αίτημα."
//
// The Helm can hold several rows for the same client. A person is their
// email; without one, their WhatsApp number; without either, their name.
// Their first row counts. A later row counts only if a charter was won
// since their last counted row: then it is a returning client's new
// request. On 6/11/2026 that was 128 requests in 130 rows.
const personKey = (r: { client_email?: unknown; client_whatsapp?: unknown; client_name?: unknown }) =>
  String(r.client_email || "").trim().toLowerCase() ||
  String(r.client_whatsapp || "").replace(/\D/g, "") ||
  `name:${String(r.client_name || "").trim().toLowerCase()}`;

export async function helmRequestsBetween(sinceIso: string, untilIso: string): Promise<HelmRequestLine[]> {
  const sb = createServiceClient();
  // Everything up to `until`, so a person who first wrote before the span
  // is recognised as already counted.
  const { data, error } = await sb
    .from("helm_requests")
    .select("id, created_at, client_name, client_email, client_whatsapp, request_type, status")
    .lt("created_at", untilIso)
    .order("created_at", { ascending: true })
    .limit(10000);
  if (error) throw new Error(`helm_requests read failed: ${error.message}`);
  // person -> has a charter been won since their last counted request?
  const wonSince = new Map<string, boolean>();
  const sinceMs = Date.parse(sinceIso);
  const out: HelmRequestLine[] = [];
  for (const r of data || []) {
    if (TEST_NAME.test(String(r.client_name || "")) || TEST_EMAIL.test(String(r.client_email || "").trim())) continue;
    const k = personKey(r);
    const known = wonSince.has(k);
    const returning = known && wonSince.get(k) === true;
    const won = r.status === "won";
    if (known && !returning) {
      // The same request, continued. It may itself be the one that closed.
      if (won) wonSince.set(k, true);
      continue;
    }
    wonSince.set(k, won);
    const at = Date.parse(String(r.created_at));
    if (at < sinceMs) continue;
    const tags = [r.request_type === "travel_agent" ? "ταξιδιωτικό γραφείο" : "", returning ? "πελάτης που ξαναήρθε" : ""].filter(Boolean);
    out.push({
      id: String(r.id),
      at,
      label: `${String(r.client_name || "").trim() || "Χωρίς όνομα"}${tags.length ? ` (${tags.join(", ")})` : ""}`,
    });
  }
  return out;
}

// A logbook day runs from 05:00 UTC on its date.
const dayStartMs = (date: string) => Date.parse(`${date}T05:00:00Z`);

// ── Visitors: ask the website ────────────────────────────────────
type SiteSpan = {
  days: DaySnapshot[];
  unique: { people: number; us: number; ai: number; google: number };
  yachts: [string, number][];
  aiBy: [string, number][];
};

async function pullSiteDays(from: string, to: string): Promise<SiteSpan> {
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
  const u = body.unique || {};
  return {
    days: body.days as DaySnapshot[],
    unique: { people: Number(u.people) || 0, us: Number(u.us) || 0, ai: Number(u.ai) || 0, google: Number(u.google) || 0 },
    yachts: Array.isArray(body.yachts) ? (body.yachts as [string, number][]) : [],
    aiBy: Array.isArray(body.aiBy) ? (body.aiBy as [string, number][]) : [],
  };
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
    const { days, unique, yachts, aiBy } = await pullSiteDays(span.from, span.to);
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
    if (days.length) {
      const through = days[days.length - 1].date;
      const record: MonthRecord = { people: unique.people, us: unique.us, ai: unique.ai, google: unique.google, aiBy, through, yachts };
      // The month still running is compared with the same days of the
      // month before (1st to the same date), when that month was counted
      // whole. Different people cannot be added up from days, so the
      // website is asked for that span too.
      const [y, m] = ym.split("-").map(Number);
      const monthEnd = isoDate(Date.UTC(y, m, 0));
      const prevYm = isoDate(Date.UTC(y, m - 1, 0)).slice(0, 7);
      if (through < monthEnd && `${prevYm}-01` >= LOGBOOK_FIRST_FULL_MONTH) {
        const prevEnd = isoDate(Date.UTC(y, m - 1, 0));
        const sameDay = `${prevYm}-${through.slice(8, 10)}`;
        const prevTo = sameDay > prevEnd ? prevEnd : sameDay;
        try {
          const prev = await pullSiteDays(`${prevYm}-01`, prevTo);
          record.prevSame = { people: prev.unique.people, us: prev.unique.us, ai: prev.unique.ai, through: prevTo };
        } catch (e) {
          console.error("logbook: same-days comparison failed:", e instanceof Error ? e.message : e);
        }
      }
      index.months[ym] = record;
    }
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

// ── SEO, GEO and AI search ───────────────────────────────────────
// George, 6/11: "κάτω κάτω μια πολύ ολοκληρωμένη ανάλυση για το SEO μας,
// με πλήρες ιστορικό από τότε που ξεκίνησε το site, ανά εβδομάδα και ανά
// μήνα, όλοι οι μήνες σαν πίνακας, τι ανέβηκε, τι έπεσε. SEO, GEO, AI
// search." The daily totals are already in logbook_gsc. This adds what
// only a per-month question to Search Console can answer, what moved in
// the last four weeks, and what we know about the AI side.
//
// What is NOT here, on purpose: clicks split into "our name" and "the
// rest". Search Console hides most queries (in August it named the query
// for 56 of 567 clicks), so that split would be an invention. What it
// does show reliably is how many different searches it lists us for and
// where we stand on them, and every page, so those are what is counted.

export type SeoMonth = {
  // Different searches Search Console lists us for in the month, and how
  // many of them had us in the first three places / on the first page.
  queries: number;
  top3: number;
  top10: number;
  // Different pages of the site that were shown at least once.
  pages: number;
  through: string;
};

export type SeoMover = {
  key: string;
  clicks: number;
  prevClicks: number;
  impressions: number;
  prevImpressions: number;
  position: number | null;
  prevPosition: number | null;
};

// How many of the weekly test questions each assistant answered with us
// in it (the Monday panel George keeps), and Bing's own count of how
// often its AI cited our pages. Kept by date from 6/11/2026 on, so a
// history builds up; before that only the latest measurement existed.
export type AiPanelSnap = { date: string; prompts: number; chatgpt: number | null; google: number | null; copilot: number | null };
export type BingAiSnap = { date: string; window: string; total: number; buying: number; share: number };

export type LogbookSeo = {
  updated_at: string;
  months: Record<string, SeoMonth>;
  // For the month still running: the same counts over the same days of
  // the month before.
  prevSame: (SeoMonth & { ym: string }) | null;
  movers: {
    start: string;
    end: string;
    prevStart: string;
    prevEnd: string;
    pagesUp: SeoMover[];
    pagesDown: SeoMover[];
    queriesUp: SeoMover[];
    queriesDown: SeoMover[];
  } | null;
  aiPanel: AiPanelSnap[];
  bingAi: BingAiSnap[];
  // Requests in The Helm whose client said, or whose visit showed, that an
  // AI assistant sent them. By month.
  aiRequests: Record<string, number>;
  // Pages in the sitemap we hand to Google.
  sitemapPages: number | null;
};

async function seoMonth(token: string, start: string, end: string): Promise<SeoMonth> {
  const [q, pg] = await Promise.all([
    gscQuery(token, { startDate: start, endDate: end, dimensions: ["query"], dataState: "all", rowLimit: 25000 }),
    gscQuery(token, { startDate: start, endDate: end, dimensions: ["page"], dataState: "all", rowLimit: 25000 }),
  ]);
  return {
    queries: q.length,
    top3: q.filter((r) => r.position <= 3).length,
    top10: q.filter((r) => r.position <= 10).length,
    pages: pg.length,
    through: end,
  };
}

function movers(now: GscRow[], before: GscRow[], by: "clicks" | "impressions", minVolume: number): { up: SeoMover[]; down: SeoMover[] } {
  const prev = new Map(before.map((r) => [r.keys[0], r]));
  const keys = new Set<string>([...now.map((r) => r.keys[0]), ...before.map((r) => r.keys[0])]);
  const cur = new Map(now.map((r) => [r.keys[0], r]));
  const rows: (SeoMover & { d: number; d2: number })[] = [];
  keys.forEach((k) => {
    const a = cur.get(k);
    const b = prev.get(k);
    const m: SeoMover = {
      key: k.replace(/^https?:\/\/(www\.)?georgeyachts\.com/, "") || "/",
      clicks: a?.clicks || 0,
      prevClicks: b?.clicks || 0,
      impressions: a?.impressions || 0,
      prevImpressions: b?.impressions || 0,
      position: a ? round1(a.position) : null,
      prevPosition: b ? round1(b.position) : null,
    };
    if (Math.max(m.impressions, m.prevImpressions) < minVolume) return;
    const dClicks = m.clicks - m.prevClicks;
    const dImpr = m.impressions - m.prevImpressions;
    rows.push({ ...m, d: by === "clicks" ? dClicks : dImpr, d2: by === "clicks" ? dImpr : dClicks });
  });
  const strip = ({ d: _d, d2: _d2, ...m }: SeoMover & { d: number; d2: number }): SeoMover => m;
  const up = rows.filter((r) => r.d > 0).sort((x, y) => y.d - x.d || y.d2 - x.d2).slice(0, 8).map(strip);
  const down = rows.filter((r) => r.d < 0).sort((x, y) => x.d - y.d || x.d2 - y.d2).slice(0, 8).map(strip);
  return { up, down };
}

async function rawSetting(k: string): Promise<string | null> {
  const sb = createServiceClient();
  const { data } = await sb.from("settings").select("value").eq("key", k).maybeSingle();
  return (data?.value as string) ?? null;
}

export async function refreshSeo(opts: { backfill?: boolean } = {}): Promise<{ months: number; computed: string[] }> {
  const token = await getAccessToken();
  const gsc = await readJson<LogbookGsc>("gsc");
  const dates = Object.keys(gsc?.days || {}).sort();
  if (!dates.length) throw new Error("no Search Console days stored yet");
  const first = dates[0];
  const last = dates[dates.length - 1];
  const stored = await readJson<LogbookSeo>("seo");
  const seo: LogbookSeo = {
    updated_at: new Date().toISOString(),
    months: { ...(stored?.months || {}) },
    prevSame: null,
    movers: stored?.movers || null,
    aiPanel: [...(stored?.aiPanel || [])],
    bingAi: [...(stored?.bingAi || [])],
    aiRequests: {},
    sitemapPages: stored?.sitemapPages ?? null,
  };

  // Months: all of them on a backfill; otherwise the running month, the
  // one before it (Search Console still revises its last days) and any
  // month not stored yet.
  const all = monthsBetween(first, last);
  const lastYm = last.slice(0, 7);
  const prevYm = addDays(`${lastYm}-01`, -1).slice(0, 7);
  const computed: string[] = [];
  for (const ym of all) {
    if (!opts.backfill && ym !== lastYm && ym !== prevYm && seo.months[ym]) continue;
    const [y, m] = ym.split("-").map(Number);
    const monthEnd = isoDate(Date.UTC(y, m, 0));
    const start = `${ym}-01` < first ? first : `${ym}-01`;
    const end = monthEnd > last ? last : monthEnd;
    seo.months[ym] = await seoMonth(token, start, end);
    computed.push(ym);
  }
  // The running month against the same days of the month before.
  const [ly, lm] = lastYm.split("-").map(Number);
  if (last < isoDate(Date.UTC(ly, lm, 0)) && `${prevYm}-01` >= first) {
    const prevEnd = addDays(`${lastYm}-01`, -1);
    const sameDay = `${prevYm}-${last.slice(8, 10)}`;
    const to = sameDay > prevEnd ? prevEnd : sameDay;
    seo.prevSame = { ym: prevYm, ...(await seoMonth(token, `${prevYm}-01`, to)) };
  }

  // What moved: the last 28 days against the 28 before them.
  const start = addDays(last, -27);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -27);
  const span = (s1: string, e1: string, dim: string) =>
    gscQuery(token, { startDate: s1, endDate: e1, dimensions: [dim], dataState: "all", rowLimit: 25000 });
  const [pNow, pBefore, qNow, qBefore] = await Promise.all([
    span(start, last, "page"),
    span(prevStart, prevEnd, "page"),
    span(start, last, "query"),
    span(prevStart, prevEnd, "query"),
  ]);
  const pages = movers(pNow, pBefore, "clicks", 10);
  // Queries move by how often we were shown: Search Console names the
  // query for too few clicks to rank by them.
  const queries = movers(qNow, qBefore, "impressions", 20);
  seo.movers = { start, end: last, prevStart, prevEnd, pagesUp: pages.up, pagesDown: pages.down, queriesUp: queries.up, queriesDown: queries.down };

  // The AI side: the weekly panel and Bing's citation count, kept by date.
  try {
    const p = JSON.parse((await rawSetting("ai_panel_latest")) || "null");
    if (p?.date && !seo.aiPanel.some((x) => x.date === p.date)) {
      seo.aiPanel.push({ date: String(p.date), prompts: Number(p.prompts) || 0, chatgpt: p.chatgpt ?? null, google: p.google ?? null, copilot: p.copilot ?? null });
    }
    const b = JSON.parse((await rawSetting("bing_ai_citations_latest")) || "null");
    if (b?.date && !seo.bingAi.some((x) => x.date === b.date)) {
      seo.bingAi.push({ date: String(b.date), window: String(b.window || ""), total: Number(b.total) || 0, buying: Number(b.buying) || 0, share: Number(b.share) || 0 });
    }
    seo.aiPanel.sort((x, y) => x.date.localeCompare(y.date));
    seo.bingAi.sort((x, y) => x.date.localeCompare(y.date));
  } catch (e) {
    console.error("logbook: AI panel read failed:", e instanceof Error ? e.message : e);
  }

  // Requests an AI assistant sent, from The Helm, by month.
  try {
    const sb = createServiceClient();
    const { data } = await sb.from("helm_requests").select("created_at, client_name, client_email, extraction").order("created_at", { ascending: true }).limit(10000);
    for (const r of data || []) {
      if (TEST_NAME.test(String(r.client_name || "")) || TEST_EMAIL.test(String(r.client_email || "").trim())) continue;
      const ex = r.extraction as { ai_source?: { assistant?: string } } | null;
      if (!ex?.ai_source?.assistant) continue;
      const ym = String(r.created_at).slice(0, 7);
      seo.aiRequests[ym] = (seo.aiRequests[ym] || 0) + 1;
    }
  } catch (e) {
    console.error("logbook: AI requests read failed:", e instanceof Error ? e.message : e);
  }

  // The sitemap we hand to Google.
  try {
    const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/sitemaps`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const j = await res.json();
      const web = (j.sitemap || []).flatMap((x: { contents?: { type: string; submitted: string }[] }) => x.contents || []).filter((c: { type: string }) => c.type === "web");
      const n = web.reduce((a: number, c: { submitted: string }) => a + (Number(c.submitted) || 0), 0);
      if (n) seo.sitemapPages = n;
    }
  } catch { /* the page simply shows no sitemap figure */ }

  await writeJson([{ name: "seo", value: seo }]);
  return { months: Object.keys(seo.months).length, computed };
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
  seo: LogbookSeo | null;
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
    if (stored && age > GOOGLE_STALE_MS) {
      await refreshGoogle();
      await refreshSeo();
    }
  } catch (e) {
    console.error("logbook: Google refresh on open failed:", e instanceof Error ? e.message : e);
  }
  const [index, gsc, queries, seo] = await Promise.all([
    readJson<LogbookIndex>("index"),
    readJson<LogbookGsc>("gsc"),
    readJson<LogbookQueries>("gsc_queries"),
    readJson<LogbookSeo>("seo"),
  ]);
  const dates = Object.keys(index?.days || {}).sort();
  const latest = dates.length ? await readDay(dates[dates.length - 1]) : null;
  return { index, gsc, queries, seo, latest };
}
