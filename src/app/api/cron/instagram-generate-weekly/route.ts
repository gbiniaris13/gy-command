// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";

// Cron: every Sunday at 07:00 UTC (10:00 Athens) Gemini generates 7
// captions in George Biniaris voice and schedules them for Mon-Sun of
// the upcoming week at 18:00 Athens (15:00 UTC in summer, 16:00 UTC in
// winter — we use fixed UTC 15:00 for now, matches the current batch).
//
// The publish cron (/api/cron/instagram-publish) then picks these up
// when their time arrives, swaps in a photo from the ROBERTO IG library,
// and publishes. Zero human input.
//
// Idempotency: refuses to run if it already scheduled posts for the
// target week (so a manual double-trigger never spams the queue).

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

// The same 15:00 UTC slot the existing hand-curated batch uses.
// That maps to 18:00 Athens in summer (EEST) and 17:00 Athens in winter.
// Peak slot per Best-Time-to-Post research.
const PUBLISH_HOUR_UTC = 15;

const SYSTEM_PROMPT = `You write Instagram captions for George Biniaris, Managing Broker of George Yachts. You return only valid JSON in the requested shape. No markdown fences, no preamble, no trailing commentary.`;

const USER_PROMPT = `You are George Biniaris, Managing Broker of George Yachts, a luxury yacht charter brokerage in Greece.

Write 7 Instagram captions for the upcoming week.

VOICE:
- Confident, personal, luxury without pretension
- Mix storytelling with industry insights
- First person, authentic, sometimes philosophical
- Like talking to a wealthy friend, not selling

TOPICS (vary across the week, don't repeat angles):
- Yacht lifestyle moments (sunrise on deck, aperitivo, anchor drop)
- Greek island secrets (Hydra, Amorgos, Cyclades, Ionian, Saronic)
- Behind-the-scenes of charter brokerage (broker day, crew briefings)
- Client experience stories (anonymized — "a family from London", "a couple from Dubai")
- Industry tips & yacht knowledge (APA, MYBA, VAT quirks, charter process)
- Personal reflections on the sea and the work

RULES:
- Length: 150-300 words each
- Include 1 engagement question per caption at the end (e.g. "What would your first stop be?")
- NO hashtags (handled separately at publish time)
- NO emojis except occasional 🇬🇷 or ⚓
- Vary tone: some inspirational, some educational, some conversational
- NEVER repeat openings ("Last July...", "Most charterers skip...") — each caption must feel like a different voice moment
- NEVER name specific clients, yacht brands unless educational

OUTPUT — strict JSON only, no markdown, no preamble:
[
  {"day": "Monday", "caption": "..."},
  {"day": "Tuesday", "caption": "..."},
  {"day": "Wednesday", "caption": "..."},
  {"day": "Thursday", "caption": "..."},
  {"day": "Friday", "caption": "..."},
  {"day": "Saturday", "caption": "..."},
  {"day": "Sunday", "caption": "..."}
]`;

/**
 * Next Monday at 15:00 UTC. If today IS Monday and it's still before
 * 15:00 UTC, we start with today; otherwise we jump to next week.
 */
function upcomingMondayUtc(now = new Date()): Date {
  const d = new Date(now.getTime());
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  let daysUntilMonday: number;
  if (day === 1 && d.getUTCHours() < PUBLISH_HOUR_UTC) {
    daysUntilMonday = 0;
  } else {
    daysUntilMonday = (1 - day + 7) % 7;
    if (daysUntilMonday === 0) daysUntilMonday = 7;
  }
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  d.setUTCHours(PUBLISH_HOUR_UTC, 0, 0, 0);
  return d;
}

export async function GET() {
  const sb = createServiceClient();
  const startMonday = upcomingMondayUtc();
  const endSunday = new Date(startMonday.getTime() + 6 * 86400000);
  endSunday.setUTCHours(PUBLISH_HOUR_UTC, 59, 59, 999);

  // Per-day idempotency: look up which days of the upcoming week
  // already have scheduled posts so we only generate captions for the
  // empty slots. This keeps hand-curated batches intact and never
  // produces duplicate same-day publishes.
  const { data: existing, error: selectErr } = await sb
    .from("ig_posts")
    .select("id, schedule_time, status")
    .gte("schedule_time", startMonday.toISOString())
    .lte("schedule_time", endSunday.toISOString())
    .in("status", ["scheduled", "publishing", "published"]);

  if (selectErr) {
    return NextResponse.json(
      { error: "Failed to check existing posts", detail: selectErr.message },
      { status: 500 }
    );
  }

  const takenDayKeys = new Set(
    (existing ?? []).map((p) => p.schedule_time.slice(0, 10))
  );
  const emptyDays: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startMonday.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    if (!takenDayKeys.has(key)) emptyDays.push(i);
  }

  if (emptyDays.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "every day of the upcoming week already has a post",
      window: { start: startMonday.toISOString(), end: endSunday.toISOString() },
      taken_days: Array.from(takenDayKeys),
    });
  }

  // Generate captions via Gemini — large token budget so the model
  // can finish all 7 × 150-300 word captions without truncation.
  // Gemini 2.5 Flash supports up to 65K output tokens; 8000 is a safe
  // cap that leaves room for system prompt + user prompt + slack.
  let raw: string;
  try {
    raw = await aiChat(SYSTEM_PROMPT, USER_PROMPT, { maxTokens: 8000 });
  } catch (err) {
    return NextResponse.json(
      { error: "AI call failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  // Parse JSON — tolerate markdown fences if the model slips up
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return NextResponse.json(
      { error: "AI response did not contain a JSON array", preview: raw.slice(0, 300) },
      { status: 502 }
    );
  }

  let parsed: Array<{ day: string; caption: string }>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to parse AI JSON",
        detail: err instanceof Error ? err.message : String(err),
        preview: raw.slice(0, 300),
      },
      { status: 502 }
    );
  }

  if (!Array.isArray(parsed) || parsed.length < 7) {
    return NextResponse.json(
      { error: `Expected 7 captions, got ${Array.isArray(parsed) ? parsed.length : 0}` },
      { status: 502 }
    );
  }

  // Map days in order — we trust the AI to return Mon..Sun but also
  // accept any ordering because we pair by index.
  const byDay = new Map<string, string>();
  for (const item of parsed) {
    if (!item?.day || !item?.caption) continue;
    byDay.set(String(item.day).toLowerCase(), String(item.caption).trim());
  }

  // Build rows ONLY for days that don't already have a post. Uses the
  // emptyDays array we computed during the idempotency check.
  const rows: Array<{ schedule_time: string; caption: string; day: string }> = [];
  for (const i of emptyDays) {
    const dayName = DAYS[i];
    const caption = byDay.get(dayName.toLowerCase());
    if (!caption) continue;
    const scheduleTime = new Date(startMonday.getTime() + i * 86400000);
    scheduleTime.setUTCHours(PUBLISH_HOUR_UTC, 0, 0, 0);
    rows.push({
      schedule_time: scheduleTime.toISOString(),
      caption,
      day: dayName,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Could not map any AI captions to days", parsed },
      { status: 502 }
    );
  }

  // Insert — image_url is intentionally blank. swapImageFromLibrary()
  // in /api/cron/instagram-publish resolves it to a ROBERTO IG photo
  // seconds before publishing.
  const { data: inserted, error: insertErr } = await sb
    .from("ig_posts")
    .insert(
      rows.map((r) => ({
        caption: r.caption,
        image_url: "", // placeholder — swap happens at publish time
        status: "scheduled",
        schedule_time: r.schedule_time,
      }))
    )
    .select("id, schedule_time");

  if (insertErr) {
    return NextResponse.json(
      { error: "Insert failed", detail: insertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    generated: rows.length,
    inserted: inserted?.length ?? 0,
    window: { start: startMonday.toISOString(), end: endSunday.toISOString() },
    previews: rows.map((r) => ({
      day: r.day,
      schedule_time: r.schedule_time,
      caption_preview: r.caption.slice(0, 100),
    })),
  });
}
