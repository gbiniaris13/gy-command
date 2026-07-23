import { NextRequest, NextResponse } from "next/server";
import { getGSCAccessToken } from "@/lib/google-intel";
import { getAccessToken, gmailFetch } from "@/lib/google-api";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";

// Monday Hunt — the weekly hunting report (George 2026-07-21: "Κάθε Δευτέρα:
// GSC θέσεις + ποιες λέξεις ανεβαίνουν + τι άρθρο/σελίδα χτυπάω την εβδομάδα").
// Every Monday 08:45 Athens it emails George (+ short Telegram) with:
//   1. The money-keyword scoreboard: position now vs last week, full table.
//   2. The movers: biggest risers/fallers across ALL queries GSC saw.
//   3. The hit list: pages sitting at positions 5-15 by impressions — the
//      "one nudge from page one" set, i.e. what this week's content work
//      should hit.
// Truth-only: real GSC numbers (7d avg vs previous 7d, 3-day data lag),
// no estimates, no AI. Complements rank-alerts (Mon+Thu ±3 alerts) with the
// full weekly picture; distinct from Friday's weekly-strategy (pipeline).

export const runtime = "nodejs";
export const maxDuration = 90;

const GEORGE_EMAIL = "george@georgeyachts.com";
const GSC_SITE = process.env.GSC_SITE_URL || "https://georgeyachts.com/";
const GSC_BASE = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
  GSC_SITE,
)}/searchAnalytics/query`;

// The queries that map to weekly charters — George's KPI (same list as
// rank-alerts so the two reports never disagree).
const MONEY_QUERIES = [
  "yacht charter greece",
  "crewed yacht charter greece",
  "motor yacht charter greece",
  "catamaran charter greece",
  "weekly motor yacht charter greece",
  "luxury yacht charter greece",
  "yacht charter athens",
  "athens yacht charter cost",
  "dodecanese yacht charter",
  "yacht charter rhodes",
  "yacht charter crete",
  "honeymoon yacht charter greece",
];

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

type Row = { position: number; impressions: number; clicks: number };

async function gscRows(
  token: string,
  start: string,
  end: string,
  dimension: "query" | "page",
): Promise<Map<string, Row>> {
  const res = await fetch(GSC_BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: [dimension], rowLimit: 1000 }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GSC ${res.status}`);
  const json = await res.json();
  const map = new Map<string, Row>();
  for (const r of json.rows ?? []) {
    map.set(r.keys[0], { position: r.position, impressions: r.impressions, clicks: r.clicks ?? 0 });
  }
  return map;
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function rawEmail(to: string, subject: string, body: string): string {
  const lines = [
    `From: GY Command <${GEORGE_EMAIL}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

async function emailGeorge(subject: string, body: string): Promise<boolean> {
  try {
    const res = await gmailFetch("/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: rawEmail(GEORGE_EMAIL, subject, body) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function _observedImpl(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let token = await getGSCAccessToken();
  if (!token) {
    try {
      token = await getAccessToken();
    } catch {
      token = null;
    }
  }
  if (!token) return NextResponse.json({ ok: false, error: "no GSC token" }, { status: 500 });

  // GSC lags ~3 days: current week = d-10..d-3, previous = d-17..d-11.
  const [curQ, prevQ, curP] = await Promise.all([
    gscRows(token, iso(10), iso(3), "query"),
    gscRows(token, iso(17), iso(11), "query"),
    gscRows(token, iso(10), iso(3), "page"),
  ]);

  // ── 1. The money scoreboard ────────────────────────────────────────────
  const board: string[] = [];
  for (const q of MONEY_QUERIES) {
    const c = curQ.get(q);
    const p = prevQ.get(q);
    if (!c) {
      board.push(`  —      "${q}" (no impressions this week)`);
      continue;
    }
    const now = r1(c.position);
    const delta = p ? r1(p.position - c.position) : null; // + = moved up
    const move = delta === null ? "new" : delta === 0 ? "=" : `${delta > 0 ? "+" : ""}${delta}`;
    board.push(`  ${String(now).padStart(5)}  (${move})  "${q}"  ·  ${c.impressions} impr, ${c.clicks} clicks`);
  }

  // ── 2. The movers across everything GSC saw ────────────────────────────
  type Move = { q: string; from: number; to: number; delta: number; impr: number };
  const moves: Move[] = [];
  for (const [q, c] of curQ) {
    const p = prevQ.get(q);
    if (!p) continue;
    if (c.impressions < 10 && p.impressions < 10) continue; // noise floor
    const delta = r1(p.position - c.position);
    if (Math.abs(delta) >= 2) {
      moves.push({ q, from: r1(p.position), to: r1(c.position), delta, impr: c.impressions });
    }
  }
  moves.sort((a, b) => b.delta - a.delta);
  const risers = moves.filter((m) => m.delta > 0).slice(0, 8);
  const fallers = moves.filter((m) => m.delta < 0).slice(-8).reverse();

  // ── 3. The hit list: one nudge from page one ───────────────────────────
  const hitList = [...curP.entries()]
    .filter(([, r]) => r.position >= 5 && r.position <= 15 && r.impressions >= 20)
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, 10)
    .map(([page, r]) => `  ${String(r1(r.position)).padStart(5)}  ${page.replace("https://georgeyachts.com", "")}  ·  ${r.impressions} impr`);

  // ── Compose ────────────────────────────────────────────────────────────
  const dateLine = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const body = [
    `Good morning George — the Monday hunt, ${dateLine}.`,
    `(GSC 7-day averages vs the week before; Google's data lags ~3 days.)`,
    ``,
    `THE MONEY SCOREBOARD`,
    ...board,
    ``,
    risers.length ? `CLIMBING (position gained)\n${risers.map((m) => `  +${m.delta}  "${m.q}"  ${m.from} → ${m.to}  ·  ${m.impr} impr`).join("\n")}` : `CLIMBING: nothing moved 2+ positions this week.`,
    ``,
    fallers.length ? `SLIPPING (watch these)\n${fallers.map((m) => `  ${m.delta}  "${m.q}"  ${m.from} → ${m.to}  ·  ${m.impr} impr`).join("\n")}` : `SLIPPING: nothing fell 2+ positions this week.`,
    ``,
    hitList.length ? `THIS WEEK'S HIT LIST — pages one nudge from page one (pos 5-15 by impressions)\n${hitList.join("\n")}\n\nThese are where the week's content work pays fastest: an internal-link push, a refresh, or a section that answers what the page almost ranks for.` : `HIT LIST: no pages currently sitting at positions 5-15 with meaningful impressions.`,
    ``,
    `All numbers straight from Search Console. No estimates.`,
  ].join("\n");

  const emailed = await emailGeorge(`\u{1F3AF} Monday hunt: ${risers.length} climbing, ${fallers.length} slipping, ${hitList.length} on the hit list`, body);

  const tg = [
    `\u{1F3AF} <b>Monday hunt</b>`,
    `\u{1F4C8} Climbing: ${risers.length}  ·  \u{1F4C9} Slipping: ${fallers.length}  ·  \u{1F3AF} Hit list: ${hitList.length}`,
    risers[0] ? `Best: "${risers[0].q}" +${risers[0].delta} (${risers[0].from} → ${risers[0].to})` : "",
    `Full report in your inbox.`,
  ]
    .filter(Boolean)
    .join("\n");
  await sendTelegram(tg);

  return NextResponse.json({
    ok: true,
    emailed,
    scoreboard: MONEY_QUERIES.length,
    risers: risers.length,
    fallers: fallers.length,
    hitList: hitList.length,
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return observeCron("monday-hunt", () => _observedImpl(request));
}
