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
// inside Instagram. There are two such things, and George chose to run
// them in turn and let the numbers decide:
//
//   "bio"  Link in bio. Judged by profile visits from the story.
//   "dm"   DM me the yacht's name. Judged by replies to the story.
//
// 2026-11-20 (George): the stories say what the research says, in his
// voice ("DM me", never "DM me"), and a story may only say "Link in bio"
// for something the link in the bio really leads to. That link is
// georgeyachts.com, and a tap on it lands on /instagram, the short brief
// ("Tell me the week. I will tell you the yacht."). So the line above
// "Link in bio" promises that, not a yacht's own page.
//
// The variant alternates with every published story. The yacht slot comes
// round every third story, so over six stories each variant meets each
// slot and each time of day equally.

export type CtaVariant = "bio" | "dm";

export const CTA_COUNTER_KEY = "story_cta_v1";
export const CTA_LOG_KEY = "story_cta_log_v1";
export const CTA_LOG_MAX = 500; // about five months at three stories a day

export function variantForCounter(counter: number): CtaVariant {
  return Math.abs(Math.trunc(counter)) % 2 === 0 ? "bio" : "dm";
}

export type CtaCopy = {
  /** Small line above the main line. */
  eyebrow: string;
  /** The main line of the banner. */
  main: string;
  /** "link" draws the link glyph before the main line; "none" draws text only. */
  icon: "link" | "none";
};

/** The banner on the Instagram story. No web address: it could not be tapped. */
export function instagramCta(opts: {
  variant: CtaVariant;
  yachtName?: string | null;
}): CtaCopy {
  // "S/CAT Ad Astra" is a catalogue habit; nobody types the prefix in a DM.
  const yacht = (opts.yachtName ?? "")
    .replace(/^\s*(S\/CAT|P\/CAT|M\/CAT|M\/Y|S\/Y|M\/S|S\/V|M\/V)\s+/i, "")
    .trim();
  if (opts.variant === "bio") {
    return yacht
      ? { eyebrow: "Tell me your dates", main: "Link in bio", icon: "link" }
      : { eyebrow: "Plan your week in Greece", main: "Link in bio", icon: "link" };
  }
  if (yacht) {
    // A long name would overflow the banner at its type size.
    const name = yacht.length > 22 ? "her name" : `"${yacht.toUpperCase()}"`;
    return { eyebrow: "Dates and rates", main: `DM me ${name}`, icon: "none" };
  }
  return { eyebrow: "Planning a week in Greece?", main: "DM me your dates", icon: "none" };
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
  const label = (v: CtaVariant) => (v === "bio" ? "Link in bio" : "DM me");
  const fmt = (n: number | null) => (n === null ? "n/a" : String(n));
  const lines = ["", "<b>Story call to action, since the test began:</b>"];
  for (const t of totals) {
    lines.push(
      `${label(t.variant)}: ${t.stories} stories (${t.measured} measured) · reach ${t.reach}` +
        ` · replies ${t.replies} (${fmt(t.replies_per_1000)} per 1,000)` +
        ` · profile visits ${t.profile_visits} (${fmt(t.profile_visits_per_1000)} per 1,000)`,
    );
  }
  if (opts.bioLinkSessions7d !== null) {
    lines.push(`Site visits from the bio link, last 7 days: ${opts.bioLinkSessions7d}`);
  }
  const enough = totals.every((t) => t.measured >= MIN_STORIES_FOR_VERDICT);
  lines.push(
    enough
      ? "<i>Both have enough stories to compare. Replies and profile visits per 1,000 reached are the numbers to read.</i>"
      : `<i>Too early to call: wait for ${MIN_STORIES_FOR_VERDICT} measured stories each.</i>`,
  );
  return lines;
}
