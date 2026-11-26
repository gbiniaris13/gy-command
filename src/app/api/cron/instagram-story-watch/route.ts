// 40 minutes after each story slot: did the slot produce a story? If not,
// run the stories job once more, then tell George what happened. Rules and
// wording in src/lib/ig-story-gap.ts (tests: scripts/ig-tests/story-gap.test.ts).

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import { emailGeorgeReport } from "@/lib/email-tracking";
import { tallyCauses, athensYmd } from "@/lib/ig-silence";
import { storyGapLevel, storyGapReport } from "@/lib/ig-story-gap";
import { CTA_LOG_KEY } from "@/lib/story-cta";

export const runtime = "nodejs";
export const maxDuration = 300;

async function lastStoryAt(sb: ReturnType<typeof createServiceClient>): Promise<string | null> {
  const { data } = await sb.from("settings").select("value").eq("key", CTA_LOG_KEY).maybeSingle();
  try {
    const log = JSON.parse(String(data?.value ?? "[]"));
    if (!Array.isArray(log) || log.length === 0) return null;
    const times = log.map((e: any) => String(e?.at ?? "")).filter(Boolean).sort();
    return times[times.length - 1] ?? null;
  } catch {
    return null;
  }
}

async function storyCauses(sb: ReturnType<typeof createServiceClient>, sinceIso: string): Promise<string[]> {
  const { data } = await sb
    .from("settings")
    .select("value")
    .like("key", "cron_end_%")
    .like("value", '%"name":"instagram-stories"%')
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false })
    .limit(20);
  const runs: Array<{ name: string; outcome: string; detail?: string | null }> = [];
  for (const row of data ?? []) {
    try {
      const v = JSON.parse(String(row.value));
      runs.push({ name: "instagram-stories", outcome: String(v.outcome ?? "unknown"), detail: v.detail ?? null });
    } catch {}
  }
  return tallyCauses(runs);
}

function appBase(): string {
  const host =
    process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || "https://command.georgeyachts.com";
  return host.startsWith("http") ? host : `https://${host}`;
}

async function _observedImpl() {
  const sb = createServiceClient();
  const now = new Date();
  const before = await lastStoryAt(sb);
  if (storyGapLevel({ lastStoryAt: before, now }) === "ok") {
    return NextResponse.json({ ok: true, last_story_at: before });
  }

  // The slot produced nothing: run the stories job once more.
  let retryDetail = "";
  try {
    const res = await fetch(`${appBase()}/api/cron/instagram-stories`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    retryDetail = body?.ok
      ? "published"
      : body?.skipped
        ? `skipped: ${body.skipped}${body.reason ? ` (${String(Array.isArray(body.reason) ? body.reason.join("; ") : body.reason).slice(0, 160)})` : ""}`
        : `error: ${String(body?.error ?? res.status).slice(0, 160)}`;
  } catch (e) {
    retryDetail = `error: ${String((e as Error)?.message ?? e).slice(0, 160)}`;
  }
  const after = await lastStoryAt(sb);
  const retryPublished = Boolean(after && after !== before);

  const since = before ?? new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const report = storyGapReport({
    lastStoryAt: before,
    now,
    retryPublished,
    retryDetail,
    causes: await storyCauses(sb, since),
  });
  await sendTelegram(report.telegram).catch(() => {});

  // The email goes at most once per Athens day.
  let emailed = false;
  if (report.level === "alarm") {
    const flag = `story_alarm_emailed_${athensYmd(now)}`;
    const { data: sent } = await sb.from("settings").select("key").eq("key", flag).maybeSingle();
    if (!sent) {
      emailed = Boolean(await emailGeorgeReport(report.subject, report.body));
      try {
        await sb.from("settings").insert({ key: flag, value: "sent", updated_at: now.toISOString() });
      } catch {}
    }
  }
  return NextResponse.json({ ok: retryPublished, level: report.level, retry: retryDetail, emailed, last_story_before: before });
}

export async function GET() {
  return observeCron("instagram-story-watch", () => _observedImpl());
}
