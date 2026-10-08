// THE MONDAY FIVE (George, 8 October 2026, research plan item 2): five
// numbers, every Monday, each against the week before, so the question
// "are requests coming?" is answered by the same five figures each time and
// not by whoever looked last.
//
//   1. Requests in the Helm (direct clients, the house's tests left out)
//   2. Sessions from chatgpt.com (GA4, sessionSource contains chatgpt/openai)
//   3. Impressions on Google (Search Console, the last seven complete days,
//      three days back because the report lags)
//   4. The ten buying prompts: in how many is the house named (ChatGPT
//      logged out, Google AI Mode; run by hand on the Mac, stored here)
//   5. Bing AI citations on buying pages, as a share of all citations
//      (Bing Webmaster Tools, AI Performance, 7 days; read on the Mac, stored)
//
// 4 and 5 cannot be fetched by a server: ChatGPT and Google AI Mode are
// read in a browser, Bing's AI report has no API. The Mac's Monday task
// writes them to settings through /api/admin/monday-five; the brief prints
// them with their date, and says so when they are older than ten days.

import { createServiceClient } from "@/lib/supabase-server";
import { getSetting, setSetting, getAccessToken, gmailFetch } from "@/lib/google-api";
import { getGA4AccessToken, getGSCAccessToken } from "@/lib/google-intel";

const GEORGE = "george@georgeyachts.com";
const GA_PROPERTY = process.env.GA_PROPERTY_ID || "513730342";
const GSC_SITE = "sc-domain:georgeyachts.com";
const G = { navy: "#0D1B2A", gold: "#DAA110", ink: "#26313D", soft: "#5A6874", line: "#E4E0D5", bg: "#FAF8F3" };
const esc = (x: unknown) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const AI_PANEL_KEY = "ai_panel_latest";
export const BING_AI_KEY = "bing_ai_citations_latest";

export type AiPanel = { date: string; prompts: number; chatgpt: number | null; google: number | null; copilot: number | null; notes?: string };
export type BingAi = { date: string; window: string; total: number; buying: number; share: number; notes?: string };

type Pair = { now: number | null; prev: number | null; note?: string };
export type MondayFive = {
  generated_at: string;
  week: { from: string; to: string };
  requests: Pair;
  chatgpt_sessions: Pair;
  gsc_impressions: Pair & { range?: string };
  ai_panel: AiPanel | null;
  bing_ai: BingAi | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000));

async function requestsPair(): Promise<Pair> {
  const db = createServiceClient();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const mid = Date.now() - 7 * 86400000;
  const { data, error } = await db
    .from("helm_requests")
    .select("created_at, client_email, client_name, request_type")
    .gte("created_at", since);
  if (error) return { now: null, prev: null, note: error.message };
  const real = (data ?? []).filter(
    (r) => r.request_type === "direct_client" && !String(r.client_email ?? "").includes("test+") && !/\(TEST\)/i.test(String(r.client_name ?? "")),
  );
  let now = 0, prev = 0;
  for (const r of real) {
    if (new Date(r.created_at).getTime() >= mid) now++;
    else prev++;
  }
  return { now, prev };
}

async function ga4Token(): Promise<string | null> {
  let t = await getGA4AccessToken().catch(() => null);
  if (!t) t = await getAccessToken().catch(() => null);
  return t;
}

async function chatgptSessionsPair(): Promise<Pair> {
  const token = await ga4Token();
  if (!token) return { now: null, prev: null, note: "no GA4 token" };
  const body = {
    dateRanges: [
      { startDate: "7daysAgo", endDate: "yesterday" },
      { startDate: "14daysAgo", endDate: "8daysAgo" },
    ],
    metrics: [{ name: "sessions" }],
    dimensionFilter: {
      orGroup: {
        expressions: [
          { filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: "chatgpt", caseSensitive: false } } },
          { filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: "openai", caseSensitive: false } } },
        ],
      },
    },
  };
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA_PROPERTY}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) return { now: null, prev: null, note: `GA4 ${res.status}` };
  const j = (await res.json()) as { rows?: { dimensionValues?: { value: string }[]; metricValues: { value: string }[] }[] };
  let now = 0, prev = 0;
  for (const r of j.rows ?? []) {
    const range = r.dimensionValues?.[0]?.value ?? "date_range_0";
    const v = Number(r.metricValues?.[0]?.value ?? 0);
    if (range === "date_range_1") prev += v; else now += v;
  }
  return { now, prev };
}

async function gscImpressionsPair(): Promise<Pair & { range?: string }> {
  let token = await getGSCAccessToken().catch(() => null);
  if (!token) token = await getAccessToken().catch(() => null);
  if (!token) return { now: null, prev: null, note: "no GSC token" };
  // The report lags two to three days; the last complete week ends three
  // days back, the week before it ends ten days back.
  const curEnd = daysAgo(3), curStart = daysAgo(9), prevEnd = daysAgo(10), prevStart = daysAgo(16);
  const q = async (startDate: string, endDate: string) => {
    const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/searchAnalytics/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, dimensions: [] }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GSC ${res.status}`);
    const j = (await res.json()) as { rows?: { impressions: number }[] };
    return Number(j.rows?.[0]?.impressions ?? 0);
  };
  try {
    const [now, prev] = await Promise.all([q(curStart, curEnd), q(prevStart, prevEnd)]);
    return { now, prev, range: `${curStart} to ${curEnd}` };
  } catch (e) {
    return { now: null, prev: null, note: String((e as Error).message) };
  }
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await getSetting(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function buildMondayFive(): Promise<MondayFive> {
  const [requests, chatgpt_sessions, gsc_impressions, ai_panel, bing_ai] = await Promise.all([
    requestsPair(),
    chatgptSessionsPair(),
    gscImpressionsPair(),
    readJson<AiPanel>(AI_PANEL_KEY),
    readJson<BingAi>(BING_AI_KEY),
  ]);
  return {
    generated_at: new Date().toISOString(),
    week: { from: daysAgo(7), to: daysAgo(1) },
    requests,
    chatgpt_sessions,
    gsc_impressions,
    ai_panel,
    bing_ai,
  };
}

function arrow(p: Pair): string {
  if (p.now == null) return "n/a";
  if (p.prev == null) return String(p.now);
  const d = p.now - p.prev;
  return `${p.now} (${d > 0 ? "+" : ""}${d} vs ${p.prev} the week before)`;
}
function ageDays(date: string): number {
  return Math.round((Date.now() - new Date(date).getTime()) / 86400000);
}
function stale(date: string): string {
  const a = ageDays(date);
  return a > 10 ? ` (from ${date}, ${a} days old, run the panel)` : ` (${date})`;
}

export function mondayFiveLines(m: MondayFive): { text: string; html?: string }[] {
  const items: { text: string; html?: string }[] = [];
  items.push({ text: `1. Requests in the Helm, last 7 days: ${arrow(m.requests)}` });
  items.push({ text: `2. Sessions from chatgpt.com: ${arrow(m.chatgpt_sessions)}${m.chatgpt_sessions.note ? ` [${m.chatgpt_sessions.note}]` : ""}` });
  items.push({ text: `3. Google impressions (Search Console, ${m.gsc_impressions.range ?? "last complete week"}): ${arrow(m.gsc_impressions)}${m.gsc_impressions.note ? ` [${m.gsc_impressions.note}]` : ""}` });
  if (m.ai_panel) {
    const p = m.ai_panel;
    const parts = [
      p.chatgpt != null ? `ChatGPT ${p.chatgpt}/${p.prompts}` : "ChatGPT not run",
      p.google != null ? `Google AI Mode ${p.google}/${p.prompts}` : "Google AI Mode not run",
      p.copilot != null ? `Copilot ${p.copilot}/${p.prompts}` : "Copilot not run",
    ];
    items.push({ text: `4. The ten buying prompts, where the house is named: ${parts.join(", ")}${stale(p.date)}` });
  } else {
    items.push({ text: "4. The ten buying prompts: no panel stored yet" });
  }
  if (m.bing_ai) {
    const b = m.bing_ai;
    items.push({ text: `5. Bing AI citations on buying pages: ${Math.round(b.share * 100)}% (${b.buying} of ${b.total}, ${b.window})${stale(b.date)}` });
  } else {
    items.push({ text: "5. Bing AI citations on buying pages: not read yet" });
  }
  return items;
}

/** A section in the morning brief's shape, printed on Mondays. */
export async function mondayFiveSection(): Promise<{ title: string; lines: string[]; html: string; count: number } | null> {
  const m = await buildMondayFive();
  const items = mondayFiveLines(m);
  const title = "The Monday five";
  const lis = items.map((i) => `<li style="margin:0 0 7px 0;line-height:1.5">${esc(i.text)}</li>`).join("");
  const hint = "Each figure against the week before. Four and five are read by hand on Monday morning and carry their date.";
  return {
    title,
    count: items.length,
    lines: [title.toUpperCase(), ...items.map((i) => `• ${i.text}`), "", hint],
    html: `<div style="margin:0 0 22px 0"><div style="font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:${G.gold};margin:0 0 8px 0">${esc(title)}</div><ul style="margin:0;padding:0 0 0 18px;color:${G.ink};font-size:14px">${lis}</ul><div style="font-size:12px;color:${G.soft};margin-top:6px">${esc(hint)}</div></div>`,
  };
}

export async function saveMondayManual(input: { ai_panel?: AiPanel; bing_ai?: BingAi }): Promise<void> {
  if (input.ai_panel) await setSetting(AI_PANEL_KEY, JSON.stringify(input.ai_panel));
  if (input.bing_ai) await setSetting(BING_AI_KEY, JSON.stringify(input.bing_ai));
}

function rawEmail(to: string, subject: string, text: string, html: string): string {
  const boundary = "gy-monday-five";
  return Buffer.from(
    [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      text,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "",
      html,
      `--${boundary}--`,
    ].join("\r\n"),
  ).toString("base64url");
}

/** One short email with the five, sent when the Mac task has refreshed four and five. */
export async function sendMondayFive(): Promise<{ sent: boolean; five: MondayFive }> {
  const five = await buildMondayFive();
  const items = mondayFiveLines(five);
  const subject = `The Monday five, ${five.week.to}`;
  const text = ["THE MONDAY FIVE", ...items.map((i) => `• ${i.text}`), "", "Each figure against the week before."].join("\n");
  const html = `<div style="font-family:Georgia,serif;background:${G.bg};padding:28px"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid ${G.line};padding:28px"><div style="font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:${G.gold};margin:0 0 10px 0">The Monday five</div><ul style="margin:0;padding:0 0 0 18px;color:${G.ink};font-size:15px;line-height:1.6">${items.map((i) => `<li style="margin:0 0 8px 0">${esc(i.text)}</li>`).join("")}</ul><div style="font-size:12px;color:${G.soft};margin-top:14px">Each figure against the week before.</div></div></div>`;
  const res = await gmailFetch("/messages/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw: rawEmail(GEORGE, subject, text, html) }) });
  return { sent: res.ok, five };
}
