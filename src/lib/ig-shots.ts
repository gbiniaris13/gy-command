// What a photograph shows: the yacht from outside, her decks, her rooms, or
// something else. George, 30/9: "ανεβάζει συνέχεια σαλόνια... θέλω να
// ανεβάζει τα σκάφη, εξωτερικά". The gallery order in Sanity is not a
// signal (index 2 and 3 are usually the saloon), the alt text is mostly
// empty, so every photograph that may reach Instagram is looked at once by
// the vision model and the verdict is kept in the settings table under
// ig_shot_<hash of url>. The feed picks exteriors; a carousel opens with
// them; an interior never goes out on its own.
//
// Unknown is treated as "not an exterior": a photograph nobody has looked
// at is not posted, which is the safe failure.

import crypto from "node:crypto";
import OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase-server";

export type Shot = "exterior" | "deck" | "interior" | "other";
const SHOTS: Shot[] = ["exterior", "deck", "interior", "other"];

export function shotKey(url: string): string {
  return `ig_shot_${crypto.createHash("sha1").update(String(url).trim()).digest("hex").slice(0, 24)}`;
}

type ShotRow = { url: string; shot: Shot; slug?: string | null; at: string };

/** Verdicts for the given URLs. Missing = never classified. */
export async function loadShots(urls: string[]): Promise<Map<string, Shot>> {
  const out = new Map<string, Shot>();
  const clean = Array.from(new Set(urls.filter((u) => typeof u === "string" && u.length > 10)));
  if (clean.length === 0) return out;
  const sb = createServiceClient();
  const byKey = new Map(clean.map((u) => [shotKey(u), u]));
  const keys = Array.from(byKey.keys());
  for (let i = 0; i < keys.length; i += 150) {
    const batch = keys.slice(i, i + 150);
    const { data } = await sb.from("settings").select("key,value").in("key", batch);
    for (const row of data ?? []) {
      const url = byKey.get(row.key);
      if (!url) continue;
      const v = typeof row.value === "string" ? safeJson(row.value) : row.value;
      const shot = v?.shot;
      if (SHOTS.includes(shot)) out.set(url, shot);
    }
  }
  return out;
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const PROMPT =
  "This is a photograph from a charter yacht listing. Answer with ONE word only.\n" +
  "EXTERIOR: the yacht (or most of her hull) seen from outside: at anchor, underway, from the air, from a tender, at a quay, a profile or bow or stern shot.\n" +
  "DECK: taken on board, outdoors: flybridge, cockpit, aft deck, sunpads, foredeck, jacuzzi on deck, dining outside, swim platform, toys in the water next to her.\n" +
  "INTERIOR: any room inside: saloon, cabin, bed, galley, bathroom, dining inside, helm station inside.\n" +
  "OTHER: food close-ups, people only, a beach or town with no yacht, a drawing, a layout plan, a map, text.\n" +
  "Reply exactly EXTERIOR, DECK, INTERIOR or OTHER.";

export async function classifyShotWithVision(url: string): Promise<Shot | null> {
  if (!process.env.AI_API_KEY) return null;
  try {
    const ai = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: process.env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
    });
    const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || "gemini-2.5-flash";
    const res = await ai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 200,
      // @ts-expect-error Gemini-only extension accepted by the OpenAI-compatible endpoint
      extra_body: { google: { thinking_config: { thinking_budget: 0, include_thoughts: false } } },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
    });
    const out = (res.choices[0]?.message?.content || "").trim().toUpperCase();
    if (out.startsWith("EXTERIOR")) return "exterior";
    if (out.startsWith("DECK")) return "deck";
    if (out.startsWith("INTERIOR")) return "interior";
    if (out.startsWith("OTHER")) return "other";
    return null;
  } catch (e) {
    console.error("[ig-shots] vision failed:", (e as Error)?.message);
    return null;
  }
}

export async function saveShot(url: string, shot: Shot, slug?: string | null): Promise<void> {
  const sb = createServiceClient();
  const row: ShotRow = { url, shot, slug: slug ?? null, at: new Date().toISOString() };
  await sb.from("settings").upsert(
    { key: shotKey(url), value: JSON.stringify(row), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

/**
 * Classify what is still unknown, up to `maxNew` photographs in this call
 * (each is one vision request), and return the verdicts for every url.
 */
export async function ensureShots(
  items: Array<{ url: string; slug?: string | null }>,
  maxNew = 40,
): Promise<{ shots: Map<string, Shot>; classified: number; remaining: number }> {
  const urls = items.map((i) => i.url);
  const shots = await loadShots(urls);
  const unknown = items.filter((i) => !shots.has(i.url));
  let classified = 0;
  for (const it of unknown.slice(0, maxNew)) {
    const shot = await classifyShotWithVision(it.url);
    if (!shot) continue;
    await saveShot(it.url, shot, it.slug);
    shots.set(it.url, shot);
    classified += 1;
  }
  return { shots, classified, remaining: Math.max(0, unknown.length - classified) };
}

/**
 * The order a carousel shows a yacht: every exterior first (gallery order,
 * so the hero leads), then at most two deck shots. Interiors, other and
 * unclassified photographs are left out.
 */
export function orderForCarousel(urls: string[], shots: Map<string, Shot>, maxDeck = 2): string[] {
  const ext = urls.filter((u) => shots.get(u) === "exterior");
  const deck = urls.filter((u) => shots.get(u) === "deck").slice(0, maxDeck);
  return [...ext, ...deck];
}

/** Sanity image URLs carry the pixel size; Instagram wants 4:5 to 1.91:1. */
export function igFriendlyUrl(u: string): boolean {
  const m = String(u).match(/-(\d+)x(\d+)\.(?:jpg|jpeg|png|webp)(?:\?|$)/i);
  if (!m) return true;
  const ratio = Number(m[1]) / Number(m[2]);
  return ratio >= 0.8 && ratio <= 1.91;
}
