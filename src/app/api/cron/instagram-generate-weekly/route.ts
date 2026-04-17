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

// 08:00 UTC = 11:00 Athens (EEST). Research shows mid-morning is peak
// for luxury travel content: users browse during work breaks, plan trips.
// Carousels get 114% more engagement than single images (Buffer 2026).
const PUBLISH_HOUR_UTC = 8;

const SYSTEM_PROMPT = `You write Instagram captions for George Biniaris, Managing Broker of George Yachts. You return only valid JSON in the requested shape. No markdown fences, no preamble, no trailing commentary.`;

const STYLES = [
  "story",
  "data",
  "personal",
  "educational",
  "reflective",
  "behind_scenes",
  "island_guide",
  "lifestyle",
] as const;

function buildUserPrompt(preferredStyle: string | null): string {
  const preferredLine = preferredStyle
    ? `\n\nSTYLE BIAS (from engagement history):\nLean at least 3 of the 7 captions into the "${preferredStyle}" style — it has measured the highest median engagement rate for this account in the last 30 days.`
    : "";
  return `You are George Biniaris, Managing Broker of George Yachts, a luxury yacht charter brokerage in Greece.

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

STYLE TAG — every caption must be tagged with ONE of these exact
values so the A/B engagement tracker can correlate style to reach:
  story | data | personal | educational | reflective | behind_scenes | island_guide | lifestyle${preferredLine}

OUTPUT — strict JSON only, no markdown, no preamble. Include "style":
[
  {"day": "Monday", "caption": "...", "style": "story"},
  {"day": "Tuesday", "caption": "...", "style": "educational"},
  {"day": "Wednesday", "caption": "...", "style": "personal"},
  {"day": "Thursday", "caption": "...", "style": "island_guide"},
  {"day": "Friday", "caption": "...", "style": "reflective"},
  {"day": "Saturday", "caption": "...", "style": "behind_scenes"},
  {"day": "Sunday", "caption": "...", "style": "lifestyle"}
]`;
}

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

  // Read the last style-preference computed by Feature #7 so we can
  // bias this week's prompt toward the style that engages most
  const { data: styleRow } = await sb
    .from("settings")
    .select("value")
    .eq("key", "ig_preferred_style")
    .maybeSingle();
  let preferredStyle: string | null = null;
  if (styleRow?.value) {
    try {
      const parsed = JSON.parse(styleRow.value);
      if (parsed?.style) preferredStyle = String(parsed.style);
    } catch {
      /* ignore */
    }
  }

  // Generate captions via Gemini — large token budget so the model
  // can finish all 7 × 150-300 word captions without truncation.
  // Gemini 2.5 Flash supports up to 65K output tokens; 8000 is a safe
  // cap that leaves room for system prompt + user prompt + slack.
  let raw: string;
  try {
    raw = await aiChat(SYSTEM_PROMPT, buildUserPrompt(preferredStyle), { maxTokens: 8000 });
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
  // accept any ordering because we pair by index. Keep the style tag
  // so we can write it to ig_posts.metadata for Feature #7 tracking.
  const byDay = new Map<string, { caption: string; style: string }>();
  for (const item of parsed) {
    if (!item?.day || !item?.caption) continue;
    const rawStyle = String(item.style ?? "").toLowerCase();
    const style = (STYLES as readonly string[]).includes(rawStyle)
      ? rawStyle
      : "personal";
    byDay.set(String(item.day).toLowerCase(), {
      caption: String(item.caption).trim(),
      style,
    });
  }

  // Build rows ONLY for days that don't already have a post. Uses the
  // emptyDays array we computed during the idempotency check.
  const rows: Array<{
    schedule_time: string;
    caption: string;
    day: string;
    style: string;
  }> = [];
  for (const i of emptyDays) {
    const dayName = DAYS[i];
    const entry = byDay.get(dayName.toLowerCase());
    if (!entry) continue;
    const scheduleTime = new Date(startMonday.getTime() + i * 86400000);
    scheduleTime.setUTCHours(PUBLISH_HOUR_UTC, 0, 0, 0);
    rows.push({
      schedule_time: scheduleTime.toISOString(),
      caption: entry.caption,
      day: dayName,
      style: entry.style,
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
  // seconds before publishing. metadata.style feeds Feature #7.
  const { data: inserted, error: insertErr } = await sb
    .from("ig_posts")
    .insert(
      rows.map((r) => ({
        caption: r.caption,
        image_url: "", // placeholder — swap happens at publish time
        status: "scheduled",
        schedule_time: r.schedule_time,
        metadata: { style: r.style, preferred_bias: preferredStyle },
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
