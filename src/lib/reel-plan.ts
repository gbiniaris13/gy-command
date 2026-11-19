// How a walkthrough reel is put together.
// Pure functions only: `node --test scripts/ig-tests/reel-plan.test.ts`.
//
// 2026-11-19 (George, after the Instagram research). Reels are how an
// account reaches people who do not follow it, and this account had
// stopped making them. George's rules for bringing them back:
//   - no generated or animated video, no generated pictures;
//   - he records nothing, no voice and no camera;
//   - the yachts' own walkthrough films may be used, for yachts cleared
//     for social only;
//   - no other company's name, logo or watermark, ever.
//
// So a reel here is eighteen seconds of the yacht's own film, kept in its
// own shape in a band across the middle of the screen, with her name and
// facts above it and George's own written words below it, changing every
// six seconds: his note, who she suits, what the week costs. The words are
// the same ones the carousel cards carry (src/lib/fleet-cards.ts), cut
// from his text on the yacht's page and never rewritten. The film's sound
// is left out: its music is not this house's to publish.
//
// Before a film is used, still frames from the chosen stretch are looked
// at for a company name, logo, watermark, address or caption burned into
// the picture. One marked frame and that stretch is not used.

import { shortName, feeLine, apaBand, factsLine, noteExcerpt, idealItems, closingLine, fleetHashtags, type CardYacht } from "./fleet-cards.ts";

/** The screen, and the window the film shows through. Shared with /api/og/reel-frame. */
export const REEL = {
  width: 1080,
  height: 1920,
  windowTop: 400,
  windowHeight: 810,
  /** Seconds of film in a reel. */
  seconds: 18,
  navy: "0D1B2A",
} as const;

export type ReelFrame =
  | { kind: "note"; yacht: string; facts: string; text: string }
  | { kind: "suits"; yacht: string; facts: string; items: string[] }
  | { kind: "cost"; yacht: string; facts: string; fee: string; line: string; cta: string };

/**
 * His note for the space under the film. Whole sentences when they fit.
 * When even the first sentence is too long, it is cut where he himself
 * paused it, at a colon, a semicolon or a spaced dash, and nowhere else:
 * what stands before such a mark is a statement of its own ("Sea Ya is
 * the boat I suggest when a party of six asks for pace"). No such mark,
 * no note frame.
 */
export function reelNote(tip: string | null | undefined, max = 190): string | null {
  const whole = noteExcerpt(tip, max);
  if (whole) return whole;
  const first = String(tip ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z"'])/)[0] ?? "";
  let cut = -1;
  for (const m of first.matchAll(/:\s|;\s|\s[-\u2013\u2014]\s/g)) {
    if ((m.index ?? 0) <= max - 1) cut = m.index ?? -1;
  }
  if (cut < 40) return null;
  return `${first.slice(0, cut).trim()}.`;
}

/** The frames a yacht can honestly carry, in the order they play. At least one, or no reel. */
export function buildReelFrames(yacht: CardYacht): ReelFrame[] {
  const name = shortName(yacht.name).toUpperCase();
  const facts = factsLine(yacht);
  const frames: ReelFrame[] = [];
  const note = reelNote(yacht.georgeInsiderTip);
  if (note) frames.push({ kind: "note", yacht: name, facts, text: note });
  const items = idealItems(yacht.idealFor, 3, 44);
  if (items.length) frames.push({ kind: "suits", yacht: name, facts, items });
  const fee = feeLine(yacht);
  if (fee) {
    frames.push({
      kind: "cost",
      yacht: name,
      facts,
      fee,
      line: `Whole yacht with her crew. APA about ${apaBand(yacht.category)} of the fee, VAT at her certified rate.`,
      cta: `DM me "${name}"`,
    });
  }
  return frames;
}

/** When each frame is on screen: equal shares of the reel, in whole seconds. */
export function frameTimes(count: number, seconds: number = REEL.seconds): Array<{ from: number; to: number | null }> {
  if (count <= 0) return [];
  const share = Math.floor(seconds / count);
  return Array.from({ length: count }, (_, i) => ({
    from: i * share,
    // The last frame stays to the end, whatever the rounding.
    to: i === count - 1 ? null : (i + 1) * share,
  }));
}

/**
 * Stretches of the film worth trying, best first: the middle, then a
 * third in, then two thirds in. The opening and the closing tenth are
 * never used: that is where a film carries its title card and its
 * maker's sign-off. Each is { start, length } in whole seconds.
 */
export function candidateWindows(durationSeconds: number, want: number = REEL.seconds): Array<{ start: number; length: number }> {
  const d = Math.floor(Number(durationSeconds) || 0);
  if (d < 12) return [];
  const edge = Math.max(2, Math.round(d * 0.1));
  const usable = d - 2 * edge;
  const length = Math.min(want, usable);
  if (length < 8) return [];
  const last = edge + usable - length;
  const at = (share: number) => Math.round(edge + (usable - length) * share);
  const starts = [at(0.5), at(0.2), at(0.8)].map((s) => Math.min(last, Math.max(edge, s)));
  const seen = new Set<number>();
  return starts.filter((s) => (seen.has(s) ? false : (seen.add(s), true))).map((start) => ({ start, length }));
}

/**
 * The seconds of the film at which still frames are taken for the check:
 * the first and last half second of the stretch and every two seconds or
 * so between, so a name that is on screen for a moment is still seen.
 */
export function checkOffsets(win: { start: number; length: number }): number[] {
  const { start, length } = win;
  const steps = Math.max(2, Math.round(length / 2.25));
  const marks = Array.from({ length: steps + 1 }, (_, i) => 0.5 + ((length - 1) * i) / steps);
  return Array.from(new Set(marks.map((m) => Math.round((start + m) * 10) / 10)));
}

export const FRAME_CHECK_PROMPT =
  "This is one frame of a film of a charter yacht. Look for anything ADDED to the picture or shown as a brand: " +
  "a company name, a company logo, a watermark, a website address, an e-mail address, a phone number, a social media handle, " +
  "a title or caption laid over the picture, credits. " +
  "The yacht's own name painted on her hull or stern, her builder's badge fixed to the boat, a flag, and numbers on a sail do NOT count. " +
  "Reply with exactly one word: MARKED if any such thing is visible, CLEAN if none is.";

/** One marked or unreadable frame and the stretch is not used. */
export function stretchVerdict(answers: Array<string | null | undefined>): "clean" | "marked" | "unknown" {
  if (answers.length === 0) return "unknown";
  const norm = answers.map((a) => String(a ?? "").trim().toUpperCase());
  if (norm.some((a) => a.startsWith("MARKED"))) return "marked";
  if (norm.every((a) => a.startsWith("CLEAN"))) return "clean";
  return "unknown";
}

/**
 * The Cloudinary transformation that makes the reel from the stored film:
 * the stretch, cut to the window's shape, set on a navy screen at the
 * window's place, the frames laid over it at their times, no sound.
 * Returned in the SDK's array form.
 */
export function reelTransformation(
  win: { start: number; length: number },
  overlays: Array<{ publicId: string; from: number; to: number | null }>,
): Array<Record<string, unknown>> {
  const below = REEL.height - REEL.windowTop - REEL.windowHeight;
  const bg = `rgb:${REEL.navy}`;
  return [
    { start_offset: win.start, duration: win.length },
    { width: REEL.width, height: REEL.windowHeight, crop: "fill", gravity: "center" },
    // Navy above the film (gravity south keeps the film at the bottom)...
    { width: REEL.width, height: REEL.windowTop + REEL.windowHeight, crop: "pad", gravity: "south", background: bg },
    // ...then navy below it.
    { width: REEL.width, height: REEL.windowTop + REEL.windowHeight + below, crop: "pad", gravity: "north", background: bg },
    ...overlays.flatMap((o) => [
      { overlay: o.publicId.replace(/\//g, ":") },
      { flags: "layer_apply", start_offset: o.from, ...(o.to === null ? {} : { end_offset: o.to }) },
    ]),
    { audio_codec: "none", video_codec: "h264", quality: "auto:good" },
  ];
}

const TYPE_WORDS: Record<string, string> = {
  "sailing-catamarans": "crewed sailing catamaran",
  "power-catamarans": "crewed power catamaran",
  "motor-yachts": "crewed motor yacht",
  "sailing-monohulls": "crewed sailing yacht",
};

/**
 * The reel's caption. No model writes it: her name and type in plain
 * search words, George's own note word for word, her weekly fee, the
 * closing line and the hashtags the carousels use.
 */
export function reelCaption(yacht: CardYacht, now: Date = new Date()): string {
  const name = shortName(yacht.name).toUpperCase();
  const type = TYPE_WORDS[String(yacht.category ?? "")] ?? "crewed yacht";
  const guests = String(yacht.sleeps ?? "").match(/\d+/)?.[0];
  const opener = `${name}, a ${type}${guests ? ` for ${guests} guests` : ""} in Greece.`;
  const note = noteExcerpt(yacht.georgeInsiderTip, 420);
  const fee = feeLine(yacht);
  const body = [opener, note, fee ? `${fee}, whole yacht with her crew.` : null].filter(Boolean).join(" ");
  const dayIndex = Math.floor(now.getTime() / 86_400_000);
  return `${body}\n\n${closingLine(yacht.name, dayIndex)}\n\n${fleetHashtags(yacht)}`;
}
