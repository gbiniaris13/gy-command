// @ts-nocheck
/**
 * Caption similarity guard.
 *
 * Roberto brief v3 — Phase 0.75, Guard 1 (but without pgvector).
 *
 * Before a publish cron commits a fresh caption to Instagram, we ask
 * Gemini "is this new caption too similar in meaning OR structure to
 * any of these 50 recent ones?". If yes, the cron regenerates up to
 * 3 times, then gives up and posts anyway (fail-open) while firing a
 * Telegram alert so George knows the AI is starting to loop.
 *
 * Why inline Gemini instead of pgvector embeddings?
 * - Library of ~200 published posts fits easily into one Gemini prompt
 *   context — no need for a vector DB.
 * - No pgvector extension to install, no VECTOR(768) column migration.
 * - Cost per check: ~$0.0001 with Gemini Flash.
 * - Same guard surface: a single yes/no + matched-id response.
 *
 * Fail-open guarantee: on any AI error or DB error, returns
 * { similar: false } so the caller publishes normally. The Telegram
 * alert fires once per distinct failure-mode-per-day so we don't spam.
 */

import { createServiceClient } from "./supabase-server";
import { aiChat } from "./ai";

const HISTORY_LIMIT = 50;

type SimilarityResult = {
  similar: boolean;
  reason?: string;
  matchedCaptionPreview?: string;
};

export async function isCaptionTooSimilar(
  newCaption: string,
  opts: { threshold?: number } = {},
): Promise<SimilarityResult> {
  const threshold = opts.threshold ?? 0.8;
  if (!newCaption || newCaption.trim().length < 30) {
    // Too short to meaningfully compare — let the quality guard handle it.
    return { similar: false };
  }

  const history = await fetchRecentCaptions(HISTORY_LIMIT);
  if (history.length === 0) return { similar: false };

  try {
    // Pack the history into a compact numbered list. Gemini Flash reads
    // this easily. We only need the similarity decision, not the raw
    // numbers — just a yes/no + which one matched so the cron can log.
    const numbered = history
      .map((c, i) => `[${i + 1}] ${c.slice(0, 500)}`)
      .join("\n\n");

    const prompt = `You are a similarity judge for Instagram captions.

NEW CAPTION:
${newCaption.slice(0, 1500)}

RECENT CAPTIONS (last ${history.length} posts):
${numbered}

Task: Decide whether the NEW caption is too similar (above ${threshold * 100}% overlap in meaning, structure, hook, OR hashtag block) to ANY of the recent captions.

Reply with ONLY a JSON object:
{
  "similar": true | false,
  "matched_index": <number 1-${history.length}> | null,
  "reason": "<short explanation, max 80 chars>"
}

Be strict — near-duplicates hurt the Instagram algorithm.`;

    const raw = await aiChat(
      "You return only JSON. No markdown, no prose.",
      prompt,
    );
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { similar: false };
    const parsed = JSON.parse(match[0]);

    if (!parsed.similar) return { similar: false };

    const idx = Number(parsed.matched_index);
    const matchedPreview =
      Number.isInteger(idx) && idx >= 1 && idx <= history.length
        ? history[idx - 1].slice(0, 140)
        : undefined;

    return {
      similar: true,
      reason: String(parsed.reason ?? "").slice(0, 200),
      matchedCaptionPreview: matchedPreview,
    };
  } catch {
    // Fail-open on AI errors.
    return { similar: false };
  }
}

async function fetchRecentCaptions(limit: number): Promise<string[]> {
  try {
    const sb = createServiceClient();
    const { data } = await sb
      .from("ig_posts")
      .select("caption")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(limit);
    return (data ?? [])
      .map((r: any) => String(r.caption ?? "").trim())
      .filter((c: string) => c.length >= 30);
  } catch {
    return [];
  }
}
