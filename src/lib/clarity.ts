/**
 * Microsoft Clarity: the daily pull and the Monday report.
 *
 * 2026-08-08. George approved switching Clarity on after the trade-off was put
 * to him plainly: it is free and unlimited, it answers the one question we have
 * been guessing at (699 clicks in ninety days and almost no enquiries, and we
 * do not know why), and the price is that Microsoft holds the visitor-behaviour
 * record as a data controller rather than as our supplier.
 *
 * WHY THIS IS TWO CRONS AND NOT ONE
 *
 * He asked for a full report every Monday. The Data Export API cannot produce
 * one in a single call, and the limits are hard:
 *
 *   - numOfDays accepts 1, 2 or 3. Nothing older than the last 72 hours.
 *   - 10 requests per project per day.
 *   - 1,000 rows per response, no pagination.
 *   - Results are returned in UTC.
 *
 * So a Monday-only job would report three days and quietly call it a week. It
 * collects daily instead, three calls a night, and Monday reads back what was
 * stored. That also outlives Clarity's own 30-day retention: the dashboard
 * forgets after a month, this does not.
 *
 * WHERE IT IS STORED
 *
 * In the existing `settings` table as one JSON row, not a new table. The live
 * Supabase project is not reachable from the MCP tooling with permission to run
 * DDL, so anything needing a migration would sit blocked waiting for a human.
 * Seven days of aggregated counts is a few kilobytes; a table would be tidier
 * and would have shipped a week later.
 *
 * Docs: learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api
 */

import { createServiceClient } from "@/lib/supabase-server";

const ENDPOINT = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

export const BUFFER_KEY = "clarity_daily_buffer";
export const DAYS_KEPT = 35;

/** The three breakdowns worth one API call each, in order of usefulness. */
export const DIMENSIONS = ["URL", "Device", "Source"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/**
 * One row of Clarity's response. Every metric shares the same envelope and
 * differs only in which extra keys ride along, so this stays deliberately
 * loose rather than pretending to know the full shape.
 */
export interface ClarityRow {
  [key: string]: string | number | undefined;
  totalSessionCount?: string;
  totalBotSessionCount?: string;
  distantUserCount?: string;
  PagesPerSessionPercentage?: number;
}

export interface ClarityMetric {
  metricName: string;
  information: ClarityRow[];
}

export interface DaySnapshot {
  /** YYYY-MM-DD, the UTC day the pull covers. */
  date: string;
  /** Keyed by dimension, each holding Clarity's metric array verbatim. */
  byDimension: Partial<Record<Dimension, ClarityMetric[]>>;
  /** Which dimensions failed, so the Monday report can say so instead of guessing. */
  failed: string[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** One call. Returns null rather than throwing, so one bad dimension does not lose the night. */
export async function fetchDimension(
  token: string,
  dimension: Dimension,
  numOfDays: 1 | 2 | 3 = 1,
): Promise<ClarityMetric[] | null> {
  const url = `${ENDPOINT}?numOfDays=${numOfDays}&dimension1=${encodeURIComponent(dimension)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? (json as ClarityMetric[]) : null;
  } catch {
    return null;
  }
}

export async function readBuffer(): Promise<DaySnapshot[]> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", BUFFER_KEY)
    .maybeSingle();
  if (!data?.value) return [];
  try {
    const parsed = JSON.parse(data.value as string) as DaySnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Replace the day if it is already there, so a re-run never double-counts. */
export async function writeDay(day: DaySnapshot): Promise<void> {
  const sb = createServiceClient();
  const existing = await readBuffer();
  const merged = [...existing.filter((d) => d.date !== day.date), day]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-DAYS_KEPT);
  await sb.from("settings").upsert(
    {
      key: BUFFER_KEY,
      value: JSON.stringify(merged),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

// ---------------------------------------------------------------------------
// Reading the week
// ---------------------------------------------------------------------------

const metric = (day: DaySnapshot, dim: Dimension, name: string): ClarityRow[] =>
  day.byDimension[dim]?.find(
    (m) => m.metricName.toLowerCase() === name.toLowerCase(),
  )?.information ?? [];

/**
 * Turn one raw Clarity URL value into the label the report prints.
 *
 * Three things happen to it. Null and empty values are dropped, because
 * Clarity emits a row for traffic it could not attribute to a page. Our own
 * origin is stripped so the column reads as paths rather than fifty repeated
 * characters of domain. The query string goes too, which is what folds
 * `/glossary/gratuity?utm_source=chatgpt.com` back into `/glossary/gratuity`
 * where it belongs; the Source breakdown already reports where people came
 * from, so keeping it here would only split one page across several lines.
 *
 * Anything that is not ours is left exactly as it arrived rather than hidden.
 * Clarity does record oddities such as `https://Electron`, and a page list
 * that quietly discards what it does not recognise is worse than one that
 * shows it.
 */
export function pageLabel(raw: string | number | undefined | null): string {
  const value = String(raw ?? "").trim();
  if (!value || value === "null" || value === "undefined") return "";
  try {
    const u = new URL(value);
    if (u.hostname.replace(/^www\./, "") === "georgeyachts.com") {
      return u.pathname || "/";
    }
  } catch {
    // Not a parseable URL, fall through and show it as it came.
  }
  return value.split("?")[0];
}

export interface PageLine {
  url: string;
  sessions: number;
  deadClicks: number;
  rageClicks: number;
  quickBacks: number;
  scriptErrors: number;
}

export interface WeekReport {
  days: number;
  from: string;
  to: string;
  sessions: number;
  botSessions: number;
  humanSessions: number;
  devices: { name: string; sessions: number }[];
  sources: { name: string; sessions: number }[];
  pages: PageLine[];
  frictionPages: PageLine[];
  missingDays: string[];
  failedPulls: string[];
}

/**
 * Fold the stored days into one week.
 *
 * The bot split is the point of this whole exercise for us. Search Console
 * showed 2,851 desktop impressions with effectively no clicks, and the reading
 * was that they are AI research agents rather than a broken snippet. Clarity
 * counts bot sessions separately, which turns that reading into a measurement.
 */
export function buildWeek(days: DaySnapshot[]): WeekReport {
  const sessionsBy = new Map<string, number>();
  const sourcesBy = new Map<string, number>();
  const pages = new Map<string, PageLine>();

  let sessions = 0;
  let bots = 0;
  const failedPulls: string[] = [];

  for (const day of days) {
    for (const f of day.failed) failedPulls.push(`${day.date}: ${f}`);

    // Sessions and bots are counted once, from the Device breakdown, because
    // every breakdown reports the same totals sliced differently and adding
    // them together would multiply the week by three.
    for (const row of metric(day, "Device", "Traffic")) {
      sessions += num(row.totalSessionCount);
      bots += num(row.totalBotSessionCount);
      const name = String(row.Device ?? "Unknown");
      sessionsBy.set(name, (sessionsBy.get(name) ?? 0) + num(row.totalSessionCount));
    }

    for (const row of metric(day, "Source", "Traffic")) {
      // Clarity sends an EMPTY STRING for direct traffic, not a missing key,
      // and ?? only catches null and undefined. The report shipped for weeks
      // with its largest referrer row wearing a blank label (78 sessions in
      // the week to 2026-08-23). Trim first, then fall back.
      const name = String(row.Source ?? "").trim() || "Direct / unknown";
      sourcesBy.set(name, (sourcesBy.get(name) ?? 0) + num(row.totalSessionCount));
    }

    const bump = (row: ClarityRow, field: keyof PageLine, value: number) => {
      // The URL dimension returns its value under `Url`, not `URL`. Reading
      // the wrong casing silently dropped EVERY page row, which is why the
      // MOST VISITED section of the weekly email was empty from the start.
      // Both spellings are accepted so a future API rename cannot repeat it.
      const url = pageLabel(row.Url ?? row.URL);
      if (!url) return;
      const line =
        pages.get(url) ??
        ({
          url,
          sessions: 0,
          deadClicks: 0,
          rageClicks: 0,
          quickBacks: 0,
          scriptErrors: 0,
        } as PageLine);
      (line[field] as number) += value;
      pages.set(url, line);
    };

    for (const row of metric(day, "URL", "Traffic")) {
      bump(row, "sessions", num(row.totalSessionCount));
    }
    for (const row of metric(day, "URL", "DeadClickCount")) {
      bump(row, "deadClicks", num(row.subTotal ?? row.deadClickCount));
    }
    for (const row of metric(day, "URL", "RageClickCount")) {
      bump(row, "rageClicks", num(row.subTotal ?? row.rageClickCount));
    }
    for (const row of metric(day, "URL", "QuickbackClick")) {
      bump(row, "quickBacks", num(row.subTotal ?? row.quickbackClick));
    }
    for (const row of metric(day, "URL", "ScriptErrorCount")) {
      bump(row, "scriptErrors", num(row.subTotal ?? row.scriptErrorCount));
    }
  }

  const dates = days.map((d) => d.date).sort();
  const all = [...pages.values()];

  return {
    days: days.length,
    from: dates[0] ?? "",
    to: dates[dates.length - 1] ?? "",
    sessions,
    botSessions: bots,
    humanSessions: Math.max(0, sessions - bots),
    devices: [...sessionsBy.entries()]
      .map(([name, s]) => ({ name, sessions: s }))
      .sort((a, b) => b.sessions - a.sessions),
    sources: [...sourcesBy.entries()]
      .map(([name, s]) => ({ name, sessions: s }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10),
    pages: all.sort((a, b) => b.sessions - a.sessions).slice(0, 15),
    // Friction is what a heatmap would show if anyone had time to open one:
    // clicks that did nothing, clicks repeated in frustration, and visits that
    // bounced straight back. Ranked by all three together.
    frictionPages: all
      .map((p) => ({ p, score: p.deadClicks + p.rageClicks * 3 + p.quickBacks }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((x) => x.p),
    missingDays: expectedDates(dates).filter((d) => !dates.includes(d)),
    failedPulls,
  };
}

/** Every date between the first and last stored day, so gaps are visible. */
function expectedDates(sorted: string[]): string[] {
  if (sorted.length < 2) return sorted;
  const out: string[] = [];
  const cur = new Date(`${sorted[0]}T00:00:00Z`);
  const end = new Date(`${sorted[sorted.length - 1]}T00:00:00Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------

const pct = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";

const pad = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);

export function renderWeekEmail(w: WeekReport): string {
  const lines: string[] = [];
  const rule = "=".repeat(64);

  lines.push(`Clarity, ${w.from} to ${w.to} (${w.days} days of data).`);
  lines.push("");

  if (w.sessions === 0) {
    lines.push(
      "No sessions were recorded this week. Clarity only records visitors who",
      "accept analytics cookies, so a quiet week can mean low traffic or a low",
      "acceptance rate, and the two look identical from here.",
      "",
    );
  }

  lines.push(rule);
  lines.push("WHO CAME");
  lines.push(rule);
  lines.push("");
  lines.push(`Sessions            ${w.sessions.toLocaleString("en-US")}`);
  lines.push(
    `Of those, bots      ${w.botSessions.toLocaleString("en-US")}  (${pct(w.botSessions, w.sessions)})`,
  );
  lines.push(
    `Real people         ${w.humanSessions.toLocaleString("en-US")}  (${pct(w.humanSessions, w.sessions)})`,
  );
  lines.push("");
  lines.push(
    "The bot line is the one to watch. Search Console shows thousands of",
    "desktop impressions with almost no clicks, and the reading has been that",
    "they are AI research agents rather than a broken snippet. This number",
    "either confirms that or ends the theory.",
  );
  lines.push("");

  if (w.devices.length) {
    lines.push("By device");
    for (const d of w.devices.slice(0, 6)) {
      lines.push(`  ${pad(d.name, 22)} ${d.sessions.toLocaleString("en-US")}`);
    }
    lines.push("");
  }

  if (w.sources.length) {
    lines.push("Where they came from");
    for (const s of w.sources) {
      lines.push(`  ${pad(s.name, 30)} ${s.sessions.toLocaleString("en-US")}`);
    }
    lines.push("");
  }

  lines.push(rule);
  lines.push("WHERE IT GOES WRONG");
  lines.push(rule);
  lines.push("");
  if (w.frictionPages.length === 0) {
    lines.push("Nothing flagged. No dead clicks, rage clicks or instant bounces.");
    lines.push("");
  } else {
    lines.push(
      "Dead click: they clicked something that is not clickable.",
      "Rage click: they clicked the same spot again and again.",
      "Quick back: they arrived and left immediately.",
      "",
      `  ${pad("Page", 42)} ${pad("dead", 6)}${pad("rage", 6)}${"back"}`,
      `  ${"-".repeat(42)} ${"-".repeat(6)}${"-".repeat(6)}${"-".repeat(6)}`,
    );
    for (const p of w.frictionPages) {
      lines.push(
        `  ${pad(p.url, 42)} ${pad(String(p.deadClicks), 6)}${pad(String(p.rageClicks), 6)}${p.quickBacks}`,
      );
    }
    lines.push("");
  }

  const errorPages = w.pages.filter((p) => p.scriptErrors > 0);
  if (errorPages.length) {
    lines.push("Pages throwing JavaScript errors on real devices");
    for (const p of errorPages.slice(0, 8)) {
      lines.push(`  ${pad(p.url, 46)} ${p.scriptErrors}`);
    }
    lines.push("");
  }

  lines.push(rule);
  lines.push("MOST VISITED");
  lines.push(rule);
  lines.push("");
  for (const p of w.pages.slice(0, 12)) {
    lines.push(`  ${pad(p.url, 50)} ${p.sessions.toLocaleString("en-US")}`);
  }
  lines.push("");

  // Never let a partial week read as a complete one.
  if (w.missingDays.length || w.failedPulls.length) {
    lines.push(rule);
    lines.push("WHAT IS MISSING FROM THIS REPORT");
    lines.push(rule);
    lines.push("");
    if (w.missingDays.length) {
      lines.push(`No data collected on: ${w.missingDays.join(", ")}`);
    }
    for (const f of w.failedPulls) lines.push(`Failed pull, ${f}`);
    lines.push("");
  }

  lines.push(rule);
  lines.push(
    "Recordings are at clarity.microsoft.com and Microsoft keeps them for 30",
    "days. The numbers above are kept here for five weeks, so the comparison",
    "outlives their dashboard.",
  );

  return lines.join("\n");
}
