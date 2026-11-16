// THE LOGBOOK, CLEAN NUMBERS (16/11/2026).
//
// George: "θέλω να βλέπω αληθινά νούμερα σε όλους τους μήνες, ώστε να
// μπορώ να συγκρίνω", only inside the Command Center, with no change to the
// website. The rules are in docs/LOGBOOK-CLEAN-RULES.md (version R1), and
// they were committed before this file computed anything.
//
// What this adds, next to the Logbook that already exists (nothing of it is
// read differently or written over):
//   - every column split into the United States and every other country,
//     counted here from the visits the website's tracker records, with an
//     exact copy of the website's person-or-machine rule;
//   - a check, day by day and month by month, that this copy gives the same
//     totals as the website's own feed (the numbers of the morning email);
//   - the raw numbers beside the clean ones, and every day that was marked
//     (a gap in the recording, a known undercount, Search Console clicks
//     that look automated) with the reason;
//   - the days the website's code changed (commits on its main branch),
//     for the charts.
//
// Stored under one new key, `${PREFIX}_clean`. Nothing else is written.

import { createServiceClient } from "./supabase-server";

const PREFIX = process.env.LOGBOOK_KEY_PREFIX || "logbook";
const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 10 * DAY_MS;

export const CLEAN_RULES_VERSION = "R1";
export const CLEAN_RULES_DATE = "2026-11-16";
export const CLEAN_FIRST_DAY = "2026-05-15";
// The commit of the website whose rules are copied below.
export const SITE_RULES_FROM = "091a363d (12/11/2026)";
// The day the site's production lock (Promote by George) was switched on.
export const PRODUCTION_LOCK_DAY = "2026-11-16";

// Rule 8: gaps known from a diagnosis, with the evidence.
export const KNOWN_GAPS: { from: string; to: string; what: "ai"; label: string }[] = [
  {
    from: "2026-10-09",
    to: "2026-10-15",
    what: "ai",
    label: "«Από AI» = υποεκτίμηση: τα κλικ του ChatGPT ήρθαν χωρίς utm και μετρήθηκαν «Απευθείας» (διάγνωση 16/11)",
  },
];

// ════════════════════════════════════════════════════════════════════
// COPY OF THE WEBSITE'S RULES (george-yachts lib/dailyReport.js, 091a363d)
// Kept line for line; only types were added. Do not change one without
// the other: the parity check below will say so if they ever drift.
// ════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */
type Session = Record<string, any>;

export const SESSION_COLUMNS = [
  "session_id", "visitor_id", "started_at", "country", "city", "region",
  "timezone", "device_type", "os", "browser", "referrer", "referrer_url",
  "utm_source", "pages_visited", "yachts_viewed", "time_on_site",
  "active_seconds", "is_return_visitor", "ip_company", "ip_is_hosting",
  "ip_is_tor", "webdriver", "webgl_renderer", "mouse_samples", "hot_score",
  "is_hot_lead", "cta_clicks", "last_cta", "scroll_deep", "copy_events",
  "copy_texts", "compare_used", "cost_calc_used", "yacht_finder_used",
  "pricing_calendar_used",
].join(",");

const MACHINE_NETWORK =
  /facebook|meta platforms|microsoft|amazon|google llc|alibaba|tencent|hetzner|\bovh\b|digitalocean|linode|oracle|sprious|logicweb|hostroyale|oculus networks|constant company|cosmonova|\bm247\b|leaseweb|contabo|datacamp|huawei cloud|bytedance|scaleway|vultr|choopa|quadranet|latitude\.sh|unified layer|incapsula|imperva|baidu|yandex|apple inc/i;
const RELAY_NETWORK = /akamai|cloudflare|fastly/i;
const SOFTWARE_RENDERER = /swiftshader|llvmpipe/i;

const pagesOf = (s: Session): any[] => (Array.isArray(s.pages_visited) ? s.pages_visited : []);
const yachtsOf = (s: Session): any[] => (Array.isArray(s.yachts_viewed) ? s.yachts_viewed : []);

export function hasActivity(s: Session): boolean {
  return (
    (s.active_seconds || 0) >= 5 ||
    (s.time_on_site || 0) >= 5 ||
    pagesOf(s).length > 1 ||
    (s.mouse_samples || 0) > 0 ||
    s.scroll_deep === true ||
    (s.cta_clicks || 0) > 0 ||
    (s.copy_events || 0) > 0
  );
}

export function machineReason(s: Session): string | null {
  const network = String(s.ip_company || "");
  if (!s.country || s.country === "??") return "automation";
  if (s.webdriver === true) return "automation";
  if (SOFTWARE_RENDERER.test(String(s.webgl_renderer || ""))) return "automation";
  if (s.ip_is_tor === true) return "automation";
  if ((s.mouse_samples || 0) >= 5) return null;
  if (MACHINE_NETWORK.test(network)) return "network";
  const relaySafari = RELAY_NETWORK.test(network) && /safari/i.test(String(s.browser || ""));
  const homeProvider = /deutsche telekom/i.test(network);
  if ((s.ip_is_hosting === true || RELAY_NETWORK.test(network)) && !relaySafari && !homeProvider) return "network";
  if ((!s.browser || s.browser === "Unknown") && (!s.os || s.os === "Unknown")) return "automation";
  if (!hasActivity(s) && (s.os === "Linux" || s.country === "CN")) return "automation";
  return null;
}

const AI_BY_NAME: [RegExp, string][] = [
  [/chatgpt|openai/, "ChatGPT"],
  [/perplexity/, "Perplexity"],
  [/claude/, "Claude"],
  [/gemini|bard\.google/, "Gemini"],
  [/copilot/, "Copilot"],
  [/grok|(^|\.)x\.ai$/, "Grok"],
  [/deepseek/, "DeepSeek"],
  [/(^|\.)meta\.ai$/, "Meta AI"],
  [/mistral/, "Mistral"],
  [/(^|\.)kimi\./, "Kimi"],
  [/(^|\.)you\.com$/, "You.com"],
  [/phind/, "Phind"],
  [/(^|\.)poe\.com$/, "Poe"],
  [/duck\.ai/, "Duck.ai"],
];
export const AI_SOURCES = new Set(AI_BY_NAME.map(([, name]) => name));
const aiNameOf = (text: string): string | null => (AI_BY_NAME.find(([re]) => re.test(text)) || [])[1] || null;

function hostOf(url: unknown): string {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const OWN_REFERRER = /(^|\.)command\.georgeyachts\.com$|^gy-command[a-z0-9-]*\.vercel\.app$/;
export function isOwnVisit(s: Session): boolean {
  return OWN_REFERRER.test(hostOf(s.referrer_url)) || OWN_REFERRER.test(String(s.referrer || "").toLowerCase());
}

export function sourceOf(s: Session): string {
  const utm = String(s.utm_source || "").toLowerCase();
  if (utm) return aiNameOf(utm) || utm.slice(0, 40);
  const host = hostOf(s.referrer_url);
  const aiHost = host && aiNameOf(host);
  if (aiHost) return aiHost;
  const r = String(s.referrer || "");
  if (!r || /^direct/i.test(r) || /georgeyachts\.com/i.test(r) || r === "Unknown") return "Απευθείας";
  if (r === "Google Search") return "Google";
  return r.replace(/^www\./, "").slice(0, 40);
}

function yachtTitle(name: unknown): string {
  return String(name || "")
    .split(/\s+/)
    .map((w) => (/^(ii|iii|iv|vi|vii|viii|ix|sy|my)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// The parts of the site's mergeVisitor that the counts use: the first
// visit of the day decides the place and the source; yachts are merged.
type Person = { id: string; country: string; source: string; yachts: number };
function mergeVisitor(sessions: Session[]): Person {
  const sorted = [...sessions].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  const first = sorted[0];
  const yachts: any[] = [];
  for (const s of sorted) for (const y of yachtsOf(s)) if (!yachts.includes(y)) yachts.push(y);
  return { id: first.visitor_id || first.session_id, country: first.country, source: sourceOf(first), yachts: yachts.length };
}

function summarize(sessions: Session[], automatedIds: Set<string>): { people: Person[]; machines: Session[]; own: number } {
  const machines: Session[] = [];
  const byVisitor = new Map<string, Session[]>();
  let own = 0;
  for (const s of sessions) {
    if (isOwnVisit(s)) {
      own += 1;
      continue;
    }
    const id = s.visitor_id || s.session_id;
    if (machineReason(s) || automatedIds.has(id)) {
      machines.push(s);
      continue;
    }
    if (!byVisitor.has(id)) byVisitor.set(id, []);
    byVisitor.get(id)!.push(s);
  }
  return { people: [...byVisitor.values()].map(mergeVisitor), machines, own };
}

function automatedVisitorIds(sessions: Session[]): Set<string> {
  const perVisitor = new Map<string, { n: number; active: boolean }>();
  for (const s of sessions) {
    const id = s.visitor_id || s.session_id;
    const v = perVisitor.get(id) || { n: 0, active: false };
    v.n += 1;
    if (hasActivity(s)) v.active = true;
    perVisitor.set(id, v);
  }
  return new Set([...perVisitor.entries()].filter(([, v]) => v.n >= 4 && !v.active).map(([id]) => id));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ════════════════════════════════════════════════════════════════════
// THE CLEAN COUNTS
// ════════════════════════════════════════════════════════════════════

// [United States, every other country]
export type Split = [number, number];

export type CleanDay = {
  people: Split;
  ai: Split;
  google: Split;
  direct: Split;
  yachtViewers: Split;
  // Raw, before any rule: every visit recorded in the day, every different
  // browser, the visits the rule took out as machines, George's own.
  raw: { visits: number; browsers: number; machineVisits: number; ownVisits: number };
};

export type CleanMonth = {
  through: string;
  days: number;
  people: Split;
  ai: Split;
  google: Split;
  direct: Split;
  yachtViewers: Split;
  raw: { visits: number; browsers: number; machineVisits: number; ownVisits: number };
};

export type ParityLine = { what: string; clean: number; site: number };

export type CleanMark = {
  date: string;
  kind: "gap" | "ai-undercount" | "gsc-automation" | "parity";
  label: string;
};

export type CleanDeployDay = { n: number; subjects: string[] };

export type LogbookClean = {
  updated_at: string;
  rules: { version: string; date: string; siteRulesFrom: string };
  days: Record<string, CleanDay>;
  months: Record<string, CleanMonth>;
  // Days and months where this copy and the website disagree. Empty is the
  // only acceptable state (rule 5).
  parity: { checkedDays: number; checkedMonths: number; mismatches: { at: string; lines: ParityLine[] }[] };
  marks: CleanMark[];
  deploys: { updated_at: string | null; through: string | null; days: Record<string, CleanDeployDay>; error?: string };
  lockDay: string;
};

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => isoDate(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS);
const dayStartMs = (date: string) => Date.parse(`${date}T05:00:00Z`);
const lastFinishedDay = (nowMs = Date.now()) => isoDate(nowMs - 29 * 60 * 60 * 1000);
const split = (items: { country: string }[]): Split => {
  const us = items.filter((p) => p.country === "US").length;
  return [us, items.length - us];
};

// ── Settings (the same table the Logbook uses) ───────────────────
async function readSetting<T>(name: string): Promise<T | null> {
  const sb = createServiceClient();
  const { data } = await sb.from("settings").select("value").eq("key", `${PREFIX}_${name}`).maybeSingle();
  if (!data?.value) return null;
  try {
    return JSON.parse(data.value as string) as T;
  } catch {
    return null;
  }
}

async function writeClean(value: LogbookClean): Promise<void> {
  const sb = createServiceClient();
  const { error } = await sb
    .from("settings")
    .upsert([{ key: `${PREFIX}_clean`, value: JSON.stringify(value), updated_at: new Date().toISOString() }], { onConflict: "key" });
  if (error) throw new Error(`settings write failed: ${error.message}`);
}

export async function readClean(): Promise<LogbookClean | null> {
  try {
    return await readSetting<LogbookClean>("clean");
  } catch {
    return null;
  }
}

// ── The visits, from the website's database (read only) ──────────
// The same database the Brand Radar panel reads (CRM_SUPABASE_*), the one
// the website's tracker writes to.
async function readSessions(sinceIso: string, untilIso: string): Promise<Session[]> {
  const url = process.env.CRM_SUPABASE_URL;
  const key = process.env.CRM_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("CRM_SUPABASE_* is not configured");
  const rows: Session[] = [];
  for (let from = 0; from < 60000; from += 1000) {
    const res = await fetch(
      `${url}/rest/v1/sessions?select=${SESSION_COLUMNS}&started_at=gte.${sinceIso}&started_at=lt.${untilIso}&order=started_at.asc,session_id.asc`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!res.ok) throw new Error(`sessions answered ${res.status}`);
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error("sessions did not return rows");
    rows.push(...page);
    if (page.length < 1000) break;
    if (from + 1000 >= 60000) throw new Error("more than 60,000 visits in one span; refusing to count a partial span");
  }
  return rows;
}

// One day, exactly as the website builds it (buildLogbookDays): the
// machines-that-return rule judged on the 10 days before the day's end.
export function cleanDay(sessions: Session[], times: number[], date: string): CleanDay {
  const start = dayStartMs(date);
  const end = start + DAY_MS;
  const slice = sessions.filter((_, i) => times[i] >= end - LOOKBACK_MS && times[i] < end);
  const automated = automatedVisitorIds(slice);
  const inDay = slice.filter((s) => {
    const t = new Date(s.started_at).getTime();
    return t >= start && t < end;
  });
  const { people, machines, own } = summarize(inDay, automated);
  return {
    people: split(people),
    ai: split(people.filter((p) => AI_SOURCES.has(p.source))),
    google: split(people.filter((p) => p.source === "Google")),
    direct: split(people.filter((p) => p.source === "Απευθείας")),
    yachtViewers: split(people.filter((p) => p.yachts > 0)),
    raw: {
      visits: inDay.length,
      browsers: new Set(inDay.map((s) => s.visitor_id || s.session_id)).size,
      machineVisits: machines.length,
      ownVisits: own,
    },
  };
}

// A whole span, exactly as the website's `unique` (different people over
// the span), split by rule 4.
export function cleanSpan(sessions: Session[], times: number[], fromDate: string, toDate: string): Omit<CleanMonth, "through" | "days" | "raw"> {
  const spanStart = dayStartMs(fromDate);
  const spanEnd = dayStartMs(toDate) + DAY_MS;
  const known = sessions.filter((_, i) => times[i] < spanEnd);
  const automated = automatedVisitorIds(known);
  const people = new Set<string>();
  const us = new Set<string>();
  const ai = new Set<string>();
  const google = new Set<string>();
  const direct = new Set<string>();
  const yachts = new Set<string>();
  for (const s of known) {
    const t = new Date(s.started_at).getTime();
    if (t < spanStart) continue;
    const id = s.visitor_id || s.session_id;
    if (isOwnVisit(s) || machineReason(s) || automated.has(id)) continue;
    people.add(id);
    if (s.country === "US") us.add(id);
    const source = sourceOf(s);
    if (source === "Google") google.add(id);
    if (source === "Απευθείας") direct.add(id);
    if (AI_SOURCES.has(source)) ai.add(id);
    if (new Set(yachtsOf(s).map(yachtTitle)).size) yachts.add(id);
  }
  const sp = (set: Set<string>): Split => {
    let u = 0;
    for (const id of set) if (us.has(id)) u += 1;
    return [u, set.size - u];
  };
  return { people: [us.size, people.size - us.size], ai: sp(ai), google: sp(google), direct: sp(direct), yachtViewers: sp(yachts) };
}

// ── The website's own numbers, as the Logbook stored them ────────
type SiteCounts = { people: number; us: number; ai: number; google: number; direct: number; yachtViewers: number };
type SiteMonth = { people: number; us: number; ai?: number; google?: number; through: string };
type SiteIndex = { days: Record<string, SiteCounts>; months: Record<string, SiteMonth> };
// [clicks, impressions, position, US clicks, US impressions, US position]
type SiteGsc = { days: Record<string, [number, number, number, number, number, number]> };

function dayParity(c: CleanDay, s: SiteCounts | undefined): ParityLine[] {
  if (!s) return [];
  const pairs: [string, number, number][] = [
    ["άνθρωποι", c.people[0] + c.people[1], s.people],
    ["ΗΠΑ", c.people[0], s.us],
    ["από AI", c.ai[0] + c.ai[1], s.ai],
    ["από Google", c.google[0] + c.google[1], s.google],
    ["απευθείας", c.direct[0] + c.direct[1], s.direct],
    ["άνοιξαν σκάφος", c.yachtViewers[0] + c.yachtViewers[1], s.yachtViewers],
  ];
  return pairs.filter(([, a, b]) => a !== b).map(([what, clean, site]) => ({ what, clean, site }));
}

function monthParity(m: CleanMonth, s: SiteMonth | undefined): ParityLine[] {
  if (!s || s.through !== m.through) return [];
  const pairs: [string, number, number | undefined][] = [
    ["άνθρωποι", m.people[0] + m.people[1], s.people],
    ["ΗΠΑ", m.people[0], s.us],
    ["από AI", m.ai[0] + m.ai[1], s.ai],
    ["από Google", m.google[0] + m.google[1], s.google],
  ];
  return pairs.filter(([, a, b]) => typeof b === "number" && a !== b).map(([what, clean, site]) => ({ what, clean, site: site as number }));
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
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// ── The website's code changes (rule 10) ─────────────────────────
// Public repository, no key needed. Only what is new since the last run is
// asked for, so one call a day is the normal cost.
async function refreshDeploys(prev: LogbookClean["deploys"] | undefined): Promise<LogbookClean["deploys"]> {
  const days: Record<string, CleanDeployDay> = { ...(prev?.days || {}) };
  // Re-read the last two Logbook days in full (from 05:00 UTC, the start of
  // a Logbook day), so no commit is ever counted twice or missed.
  const fromDay = prev?.through ? addDays(prev.through, -2) : CLEAN_FIRST_DAY;
  const since = new Date(dayStartMs(fromDay)).toISOString();
  for (const d of Object.keys(days)) if (d >= fromDay) delete days[d];
  const seen: { date: string; subject: string }[] = [];
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(
      `https://api.github.com/repos/gbiniaris13/george-yachts/commits?sha=main&since=${since}&per_page=100&page=${page}`,
      { headers: { Accept: "application/vnd.github+json", "User-Agent": "gy-command-logbook" }, cache: "no-store", signal: AbortSignal.timeout(20000) },
    );
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error("GitHub did not return a list");
    for (const c of list) {
      const msg = String(c?.commit?.message || "");
      if (/\[skip (ci|vercel)\]/i.test(msg)) continue;
      const at = c?.commit?.committer?.date || c?.commit?.author?.date;
      if (!at) continue;
      // The same day as the Logbook: from 05:00 UTC.
      const date = isoDate(Date.parse(at) - 5 * 60 * 60 * 1000);
      seen.push({ date, subject: msg.split("\n")[0].slice(0, 120) });
    }
    if (list.length < 100) break;
  }
  for (const { date, subject } of seen) {
    const d = (days[date] ||= { n: 0, subjects: [] });
    d.n += 1;
    if (d.subjects.length < 12) d.subjects.push(subject);
  }
  return { updated_at: new Date().toISOString(), through: lastFinishedDay(), days };
}

// ── The refresh ──────────────────────────────────────────────────
// By default the month of the last finished day (and the month before it
// during the first three days of a month). backfill: every month since the
// first day. Each month is read with the 10 days before it, like the site.
export async function refreshClean(opts: { backfill?: boolean; months?: string[] } = {}): Promise<{
  months: string[];
  days: number;
  mismatches: number;
  marks: number;
  deploysError?: string;
}> {
  const lastDay = lastFinishedDay();
  let months = opts.months;
  if (!months?.length) {
    if (opts.backfill) months = monthsBetween(CLEAN_FIRST_DAY, lastDay);
    else {
      months = [lastDay.slice(0, 7)];
      if (Number(lastDay.slice(8, 10)) <= 3) months.unshift(addDays(`${months[0]}-01`, -1).slice(0, 7));
    }
  }

  const prev = await readClean();
  // A different rules version means the whole history is counted again.
  const sameRules = prev?.rules?.version === CLEAN_RULES_VERSION;
  if (!sameRules && !opts.backfill && !opts.months?.length) months = monthsBetween(CLEAN_FIRST_DAY, lastDay);
  const out: LogbookClean = {
    updated_at: new Date().toISOString(),
    rules: { version: CLEAN_RULES_VERSION, date: CLEAN_RULES_DATE, siteRulesFrom: SITE_RULES_FROM },
    days: sameRules ? { ...(prev?.days || {}) } : {},
    months: sameRules ? { ...(prev?.months || {}) } : {},
    parity: { checkedDays: 0, checkedMonths: 0, mismatches: [] },
    marks: [],
    deploys: prev?.deploys || { updated_at: null, through: null, days: {} },
    lockDay: PRODUCTION_LOCK_DAY,
  };

  let counted = 0;
  for (const ym of months) {
    const [y, m] = ym.split("-").map(Number);
    const first = `${ym}-01` < CLEAN_FIRST_DAY ? CLEAN_FIRST_DAY : `${ym}-01`;
    const monthEnd = isoDate(Date.UTC(y, m, 0));
    const last = monthEnd > lastDay ? lastDay : monthEnd;
    if (first > last) continue;
    const sessions = await readSessions(
      new Date(dayStartMs(first) - LOOKBACK_MS).toISOString(),
      new Date(dayStartMs(last) + DAY_MS).toISOString(),
    );
    const times = sessions.map((s) => new Date(s.started_at).getTime());
    const raw = { visits: 0, browsers: 0, machineVisits: 0, ownVisits: 0 };
    let nDays = 0;
    for (let date = first; date <= last; date = addDays(date, 1)) {
      const d = cleanDay(sessions, times, date);
      out.days[date] = d;
      raw.visits += d.raw.visits;
      raw.machineVisits += d.raw.machineVisits;
      raw.ownVisits += d.raw.ownVisits;
      nDays += 1;
      counted += 1;
    }
    const spanStart = dayStartMs(first);
    const spanEnd = dayStartMs(last) + DAY_MS;
    raw.browsers = new Set(sessions.filter((_, i) => times[i] >= spanStart && times[i] < spanEnd).map((s) => s.visitor_id || s.session_id)).size;
    out.months[ym] = { through: last, days: nDays, ...cleanSpan(sessions, times, first, last), raw };
  }

  // Rule 5: parity with the website's own numbers, for everything stored.
  const site = await readSetting<SiteIndex>("index");
  for (const date of Object.keys(out.days).sort()) {
    const s = site?.days?.[date];
    if (!s) continue;
    out.parity.checkedDays += 1;
    const lines = dayParity(out.days[date], s);
    if (lines.length) out.parity.mismatches.push({ at: date, lines });
  }
  for (const ym of Object.keys(out.months).sort()) {
    const s = site?.months?.[ym];
    if (!s || s.through !== out.months[ym].through) continue;
    out.parity.checkedMonths += 1;
    const lines = monthParity(out.months[ym], s);
    if (lines.length) out.parity.mismatches.push({ at: ym, lines });
  }

  // Rule 7: gaps in the recording.
  const dates = Object.keys(out.days).sort();
  dates.forEach((date, i) => {
    const before = dates.slice(Math.max(0, i - 14), i).map((d) => out.days[d].raw.visits);
    if (before.length < 7) return;
    const sorted = [...before].sort((a, b) => a - b);
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const v = out.days[date].raw.visits;
    if (median > 0 && v < 0.2 * median) {
      out.marks.push({ date, kind: "gap", label: `κενό μέτρησης: ο tracker κατέγραψε ${v} επισκέψεις, ο διάμεσος των 14 προηγούμενων ημερών ήταν ${median}` });
    }
  });
  // Rule 8: known gaps.
  for (const g of KNOWN_GAPS) {
    for (let date = g.from; date <= g.to; date = addDays(date, 1)) {
      if (out.days[date]) out.marks.push({ date, kind: "ai-undercount", label: g.label });
    }
  }
  // Rule 9: Search Console clicks that look automated.
  const gsc = await readSetting<SiteGsc>("gsc");
  for (const date of dates) {
    const g = gsc?.days?.[date];
    if (!g) continue;
    const usClicks = g[3];
    const usFromGoogle = out.days[date].google[0];
    if (usClicks >= 10 && usClicks >= 3 * (usFromGoogle + 1)) {
      out.marks.push({ date, kind: "gsc-automation", label: `πιθανά κλικ αυτοματισμού: ${usClicks} κλικ ΗΠΑ στο Search Console, ${usFromGoogle} άνθρωποι ΗΠΑ από Google` });
    }
  }
  // Rule 5 again, as a mark on the day, so the page can show it in place.
  for (const mm of out.parity.mismatches) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(mm.at)) {
      out.marks.push({ date: mm.at, kind: "parity", label: `δεν ταιριάζει με το site: ${mm.lines.map((l) => `${l.what} ${l.clean} έναντι ${l.site}`).join(", ")}` });
    }
  }
  out.marks.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  // Rule 10: the website's code changes. A failure here never stops the
  // counts; the last list is kept and the error is shown.
  let deploysError: string | undefined;
  try {
    out.deploys = await refreshDeploys(prev?.deploys);
  } catch (e) {
    deploysError = e instanceof Error ? e.message : "unknown";
    out.deploys = { ...(prev?.deploys || { updated_at: null, through: null, days: {} }), error: deploysError };
  }

  await writeClean(out);
  return { months, days: counted, mismatches: out.parity.mismatches.length, marks: out.marks.length, deploysError };
}
