// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// The outreach bot runs in Google Apps Script on a Google Sheet, so the
// source-of-truth for Total Sent / Opens / Replies / Bounces / Leads
// Remaining / Active Follow-ups lives in the sheet, not in Supabase.
// This endpoint stores a snapshot in the existing `settings` table keyed
// by `outreach_stats`. Two ways to update the snapshot:
//
//   1. The bot POSTs with a secret (future automation)
//   2. George edits it manually from the dashboard
//
// GET merges the snapshot with live CRM-derived counts so the UI is never
// blank on day one.

const STATS_KEY = "outreach_stats";
// Per-bot keys. Both Apps Script bots can POST a `bot` discriminator —
// "george" or "elleanna" — and the snapshot lands in its own row. The
// dashboard reads both and renders side-by-side. Backwards compatible:
// if a bot omits `bot`, the snapshot lands in the legacy single key.
const BOT_KEY = (bot: BotId) => `outreach_stats:${bot}`;
const VALID_BOTS = ["george", "elleanna"] as const;
type BotId = (typeof VALID_BOTS)[number];
function parseBot(v: unknown): BotId | null {
  return typeof v === "string" && (VALID_BOTS as readonly string[]).includes(v)
    ? (v as BotId)
    : null;
}

interface StatsSnapshot {
  total_sent: number;
  opens: number;
  replies: number;
  bounces: number;
  leads_remaining: number;
  active_followups: number;
  updated_at?: string;
  source?: "bot" | "manual";
  bot?: BotId;
}

const EMPTY_SNAPSHOT: StatsSnapshot = {
  total_sent: 0,
  opens: 0,
  replies: 0,
  bounces: 0,
  leads_remaining: 0,
  active_followups: 0,
};

async function readSnapshot(sb, key: string = STATS_KEY): Promise<StatsSnapshot | null> {
  const { data } = await sb
    .from("settings")
    .select("value, updated_at")
    .eq("key", key)
    .maybeSingle();
  if (!data?.value) return null;
  try {
    const parsed = JSON.parse(data.value) as StatsSnapshot;
    return { ...parsed, updated_at: data.updated_at ?? parsed.updated_at };
  } catch {
    return null;
  }
}

async function readPerBotSnapshots(sb): Promise<Record<BotId, StatsSnapshot | null>> {
  const [g, e] = await Promise.all([
    readSnapshot(sb, BOT_KEY("george")),
    readSnapshot(sb, BOT_KEY("elleanna")),
  ]);
  return { george: g, elleanna: e };
}

function sanitizeStats(body: Partial<StatsSnapshot>): StatsSnapshot {
  const n = (v: unknown): number => {
    const num = Number(v);
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : 0;
  };
  return {
    total_sent: n(body.total_sent),
    opens: n(body.opens),
    replies: n(body.replies),
    bounces: n(body.bounces),
    leads_remaining: n(body.leads_remaining),
    active_followups: n(body.active_followups),
  };
}

export async function GET() {
  const sb = createServiceClient();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now.getTime() - 7 * 86400000);

  const [todayRes, weekRes, totalRes, recentRes, snapshot, perBot] = await Promise.all([
    sb
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("source", "outreach_bot")
      .gte("created_at", todayStart.toISOString()),
    sb
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("source", "outreach_bot")
      .gte("created_at", weekStart.toISOString()),
    sb
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("source", "outreach_bot"),
    sb
      .from("activities")
      .select("description, created_at, type")
      .or(
        "type.eq.email_sent,type.eq.reply_received,type.eq.lead_captured,type.eq.outreach_sync"
      )
      .order("created_at", { ascending: false })
      .limit(10),
    readSnapshot(sb),
    readPerBotSnapshots(sb),
  ]);

  const recent = (recentRes.data ?? []).map((a) => ({
    text: a.description ?? "",
    date: a.created_at ?? now.toISOString(),
    type: a.type === "reply_received" ? "reply" : "sent",
  }));

  const stats: StatsSnapshot = snapshot ?? EMPTY_SNAPSHOT;

  return NextResponse.json({
    stats,
    hasSnapshot: !!snapshot,
    perBot: {
      // null when that bot has never POSTed with a `bot` field.
      george: perBot.george,
      elleanna: perBot.elleanna,
    },
    derived: {
      contacts_today: todayRes.count ?? 0,
      contacts_week: weekRes.count ?? 0,
      contacts_total: totalRes.count ?? 0,
    },
    today: { sent: todayRes.count ?? 0, opens: 0, replies: 0, bounces: 0 },
    week: { sent: weekRes.count ?? 0, opens: 0, replies: 0, bounces: 0 },
    total: {
      sent: snapshot?.total_sent ?? totalRes.count ?? 0,
      opens: snapshot?.opens ?? 0,
      replies: snapshot?.replies ?? 0,
      bounces: snapshot?.bounces ?? 0,
    },
    recent,
    botActive: (totalRes.count ?? 0) > 0,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const expected = process.env.SYNC_SECRET;
    if (!expected || body.secret !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stats = sanitizeStats(body);
    const bot = parseBot(body.bot);
    const payload: StatsSnapshot = {
      ...stats,
      updated_at: new Date().toISOString(),
      source: body.source === "bot" ? "bot" : "manual",
      ...(bot ? { bot } : {}),
    };

    const sb = createServiceClient();
    // Always write to the legacy single key for backwards compat with the
    // existing dashboard fallback. If a `bot` discriminator is set, ALSO
    // write the per-bot key so the per-bot UI lights up.
    const writes = [
      sb.from("settings").upsert(
        {
          key: STATS_KEY,
          value: JSON.stringify(payload),
          updated_at: payload.updated_at,
        },
        { onConflict: "key" }
      ),
    ];
    if (bot) {
      writes.push(
        sb.from("settings").upsert(
          {
            key: BOT_KEY(bot),
            value: JSON.stringify(payload),
            updated_at: payload.updated_at,
          },
          { onConflict: "key" }
        )
      );
    }
    const results = await Promise.all(writes);
    const error = results.find((r) => r.error)?.error ?? null;

    if (error) {
      return NextResponse.json(
        { error: "Failed to persist snapshot", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, stats: payload });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
