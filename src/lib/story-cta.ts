// What a story asks the viewer to do, and whether it worked.
// Pure functions only (no imports): `node --test scripts/ig-tests/story-cta.test.ts`.
//
// 2026-11-19 (George). Every story used to carry a banner that said
// "Tap to view yacht" above a web address drawn into the picture. Nothing
// was tappable: Meta's publishing API does not accept link stickers
// ("Publishing stickers (i.e., link, poll, location) is not supported").
// In seven months and about 600 stories, no visit to the site ever
// arrived from one (0 of 17,030 sessions carried utm_medium=story).
//
// A story can only ask for something the viewer can actually do from
// inside Instagram. Two were tried in turn from 19 November: "Link in
// bio" and a request for a message.
//
// 2026-11-20 (George): "Link in bio" is retired. The banner is drawn as a
// gold-bordered box with a link glyph, so it read as a button, and a
// viewer who tapped it (George among them, three times) went nowhere and
// concluded there was no link. A story now asks for the one thing that
// works from where the viewer is: a message, typed in the reply field
// under the story.
//
// The same day George settled the voice: the PROFILE (bio, stories) speaks
// as the house, "us"; the POSTS (captions, cards, reels) stay in his own
// first person. So the banner says "Message us", not "DM me".
//
// The "bio" variant stays in the type and in the log so the stories that
// ran with it can still be read in the weekly report.

export type CtaVariant = "bio" | "dm";

export const CTA_COUNTER_KEY = "story_cta_v1";
export const CTA_LOG_KEY = "story_cta_log_v1";
export const CTA_LOG_MAX = 500; // about five months at three stories a day

/** Every story asks for a message since 2026-11-20 (see the header). */
export function variantForCounter(_counter: number): CtaVariant {
  return "dm";
}

export type CtaCopy = {
  /** Small line above the main line. */
  eyebrow: string;
  /** The main line of the banner. */
  main: string;
  /** "link" draws the link glyph before the main line; "none" draws text only. */
  icon: "link" | "none";
};

/** The banner on the Instagram story: a request for a message, in the house's voice. */
export function instagramCta(opts: {
  variant?: CtaVariant;
  yachtName?: string | null;
}): CtaCopy {
  // "S/CAT Ad Astra" is a catalogue habit; nobody types the prefix in a message.
  const yacht = (opts.yachtName ?? "")
    .replace(/^\s*(S\/CAT|P\/CAT|M\/CAT|M\/Y|S\/Y|M\/S|S\/V|M\/V)\s+/i, "")
    .trim();
  if (yacht) {
    // A long name would overflow the banner at its type size.
    const name = yacht.length > 17 ? "her name" : `"${yacht.toUpperCase()}"`;
    return { eyebrow: "Dates and rates on request", main: `Message us ${name}`, icon: "none" };
  }
  return { eyebrow: "Planning a week in Greece?", main: "Message us your dates", icon: "none" };
}

/**
 * The same story is mirrored to the Facebook Page, where "link in bio"
 * means nothing. Facebook gets the address, short enough to type.
 */
export function facebookCta(): CtaCopy {
  return { eyebrow: "Crewed yacht charter in Greece", main: "georgeyachts.com", icon: "link" };
}

export type StoryInsights = {
  reach?: number;
  replies?: number;
  profile_visits?: number;
  follows?: number;
  shares?: number;
  total_interactions?: number;
  navigation?: number;
  views?: number;
  fetched_at?: string;
};

export type CtaLogEntry = {
  media_id: string;
  at: string;
  variant: CtaVariant;
  slot: "yacht" | "greece";
  yacht_slug: string | null;
  insights?: StoryInsights;
};

export function appendCtaLog(log: CtaLogEntry[], entry: CtaLogEntry): CtaLogEntry[] {
  const next = log.filter((e) => e.media_id !== entry.media_id);
  next.push(entry);
  return next.slice(-CTA_LOG_MAX);
}

/**
 * Stores the latest numbers for a story. Counters on a story only grow
 * while it is live, so a later reading never lowers an earlier one (a
 * failed or partial fetch must not erase what was already recorded).
 */
export function mergeInsights(
  log: CtaLogEntry[],
  mediaId: string,
  fresh: StoryInsights,
): { log: CtaLogEntry[]; matched: boolean } {
  let matched = false;
  const out = log.map((e) => {
    if (e.media_id !== mediaId) return e;
    matched = true;
    const prev = e.insights ?? {};
    const merged: StoryInsights = { ...prev };
    for (const [k, v] of Object.entries(fresh)) {
      if (k === "fetched_at") continue;
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const before = (prev as Record<string, unknown>)[k];
      (merged as Record<string, unknown>)[k] = typeof before === "number" ? Math.max(before, v) : v;
    }
    merged.fetched_at = fresh.fetched_at ?? prev.fetched_at;
    return { ...e, insights: merged };
  });
  return { log: out, matched };
}

export type VariantTotals = {
  variant: CtaVariant;
  stories: number;
  measured: number;
  reach: number;
  replies: number;
  profile_visits: number;
  /** Per 1,000 accounts reached, so variants with different reach compare fairly. */
  replies_per_1000: number | null;
  profile_visits_per_1000: number | null;
};

export function totalsByVariant(log: CtaLogEntry[], sinceIso?: string): VariantTotals[] {
  const rows = sinceIso ? log.filter((e) => e.at >= sinceIso) : log;
  return (["bio", "dm"] as CtaVariant[]).map((variant) => {
    const mine = rows.filter((e) => e.variant === variant);
    const measured = mine.filter((e) => typeof e.insights?.reach === "number");
    const sum = (k: "reach" | "replies" | "profile_visits") =>
      measured.reduce((t, e) => t + (e.insights?.[k] ?? 0), 0);
    const reach = sum("reach");
    const per = (n: number) => (reach > 0 ? Math.round((n / reach) * 10000) / 10 : null);
    return {
      variant,
      stories: mine.length,
      measured: measured.length,
      reach,
      replies: sum("replies"),
      profile_visits: sum("profile_visits"),
      replies_per_1000: per(sum("replies")),
      profile_visits_per_1000: per(sum("profile_visits")),
    };
  });
}

/** Below this many measured stories per variant, a difference is noise. */
export const MIN_STORIES_FOR_VERDICT = 20;

/** Telegram HTML lines for the weekly report. Empty when the test has no data yet. */
export function ctaReportLines(opts: {
  log: CtaLogEntry[];
  bioLinkSessions7d: number | null;
  sinceIso?: string;
}): string[] {
  const totals = totalsByVariant(opts.log, opts.sinceIso);
  if (totals.every((t) => t.stories === 0)) return [];
  const label = (v: CtaVariant) => (v === "bio" ? "Link in bio (retired 20 Nov)" : "Message us");
  const fmt = (n: number | null) => (n === null ? "n/a" : String(n));
  const lines = ["", "<b>Story call to action:</b>"];
  for (const t of totals.filter((x) => x.stories > 0)) {
    lines.push(
      `${label(t.variant)}: ${t.stories} stories (${t.measured} measured) · reach ${t.reach}` +
        ` · replies ${t.replies} (${fmt(t.replies_per_1000)} per 1,000)` +
        ` · profile visits ${t.profile_visits} (${fmt(t.profile_visits_per_1000)} per 1,000)`,
    );
  }
  if (opts.bioLinkSessions7d !== null) {
    lines.push(`Site visits from the bio link, last 7 days: ${opts.bioLinkSessions7d}`);
  }
  lines.push(
    "<i>\"Link in bio\" was retired on 20 November: drawn as a button, it could not be tapped. Replies per 1,000 reached is the number to read.</i>",
  );
  return lines;
}
