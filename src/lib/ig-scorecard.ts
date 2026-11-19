// The weekly scorecard: the few numbers that say whether Instagram is
// turning into enquiries. Pure functions only:
// `node --test scripts/ig-tests/ig-scorecard.test.ts`.
//
// 2026-11-19 (George, after the Instagram research). The Monday report
// used to lead with followers and an "engagement rate". Neither predicts
// an enquiry. The research names what does: how far a reel travels, how
// often a post is saved and sent on, how many people go to the profile,
// how many tap through to the site, how many write, and how many briefs
// arrive. Each is shown per post, against last week and against the
// research's own target for this point in the plan. The targets are the
// research's judgement, not a promise; they are printed so a number has
// something to be read against.

export const PLAN_START = "2026-11-19";

export type PostRow = {
  kind: "reel" | "yacht" | "guide" | "other";
  reach: number | null;
  saves: number | null;
  shares: number | null;
  profileVisits: number | null;
};

export type WeekNumbers = {
  posts: PostRow[];
  /** Direct messages received. */
  messages: number;
  /** Comments from people, left for George to answer. */
  comments: number;
  /** Visits to the site that came from Instagram. */
  siteVisits: number;
  /** Of those visits, how many sent a brief. */
  briefs: number;
};

/** metadata.kind on ig_posts -> the three things the feed now carries. */
export function kindOf(metadataKind: unknown): PostRow["kind"] {
  const k = String(metadataKind ?? "");
  if (k === "reel_walkthrough" || k === "reel") return "reel";
  if (k === "fleet") return "yacht";
  if (k === "guide") return "guide";
  return "other";
}

/** The research's targets for day 30, 60 and 90 of the plan. */
const TARGETS = [
  { day: 30, reelReach: 600, sendsPer1000: 8, saves: 2, profileVisits: 5, siteVisits: 10, messages: 2 },
  { day: 60, reelReach: 1200, sendsPer1000: 10, saves: 4, profileVisits: 10, siteVisits: 20, messages: 4 },
  { day: 90, reelReach: 2000, sendsPer1000: 15, saves: 6, profileVisits: 15, siteVisits: 35, messages: 6 },
];

export function targetFor(now: Date) {
  const day = Math.floor((now.getTime() - new Date(`${PLAN_START}T00:00:00Z`).getTime()) / 86_400_000);
  return { planDay: Math.max(0, day), ...(TARGETS.find((t) => day <= t.day) ?? TARGETS[TARGETS.length - 1]) };
}

const measured = (rows: PostRow[], f: (r: PostRow) => number | null) => rows.map(f).filter((v): v is number => typeof v === "number");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n: number | null, d = 0) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

export function summarise(week: WeekNumbers) {
  const reels = week.posts.filter((p) => p.kind === "reel");
  const reach = measured(week.posts, (p) => p.reach).reduce((a, b) => a + b, 0);
  const shares = measured(week.posts, (p) => p.shares).reduce((a, b) => a + b, 0);
  return {
    posts: week.posts.length,
    reels: reels.length,
    yachts: week.posts.filter((p) => p.kind === "yacht").length,
    guides: week.posts.filter((p) => p.kind === "guide").length,
    others: week.posts.filter((p) => p.kind === "other").length,
    reelReach: round(avg(measured(reels, (p) => p.reach))),
    reachPerPost: round(avg(measured(week.posts, (p) => p.reach))),
    savesPerPost: round(avg(measured(week.posts, (p) => p.saves)), 1),
    profileVisitsPerPost: round(avg(measured(week.posts, (p) => p.profileVisits)), 1),
    /** Sends (shares) for every thousand accounts reached. */
    sendsPer1000: reach > 0 ? round((shares / reach) * 1000, 1) : null,
    messages: week.messages,
    comments: week.comments,
    siteVisits: week.siteVisits,
    briefs: week.briefs,
  };
}

const show = (v: number | null) => (v === null ? "not measured yet" : v.toLocaleString("en-US"));

function line(label: string, now: number | null, before: number | null, target?: number): string {
  const parts = [`<b>${label}</b>: ${show(now)}`];
  const notes: string[] = [];
  if (before !== null) notes.push(`last week ${show(before)}`);
  if (typeof target === "number") notes.push(`target ${target.toLocaleString("en-US")}`);
  if (notes.length) parts.push(`(${notes.join(", ")})`);
  return parts.join(" ");
}

/** The scorecard as Telegram lines. Says plainly when there is nothing to measure. */
export function scorecardLines(thisWeek: WeekNumbers, lastWeek: WeekNumbers, now: Date): string[] {
  const a = summarise(thisWeek);
  const b = summarise(lastWeek);
  const t = targetFor(now);
  const out = [
    "",
    `📊 <b>Does Instagram bring enquiries? Week to ${now.toISOString().slice(0, 10)}</b> (day ${t.planDay} of the plan, targets for day ${t.day})`,
  ];
  if (a.posts === 0) {
    out.push("No post went out this week, so there is nothing to measure. The silence alarm says why.");
  } else {
    out.push(
      `<b>Went out</b>: ${a.reels} reel${a.reels === 1 ? "" : "s"}, ${a.yachts} yacht carousel${a.yachts === 1 ? "" : "s"}, ${a.guides} guide${a.guides === 1 ? "" : "s"}${a.others ? `, ${a.others} other` : ""}`,
      a.reels === 0
        ? `<b>People reached per reel</b>: no reel went out (target ${t.reelReach.toLocaleString("en-US")})`
        : line("People reached per reel", a.reelReach, b.reelReach, t.reelReach),
      line("People reached per post, all kinds", a.reachPerPost, b.reachPerPost),
      line("Saves per post", a.savesPerPost, b.savesPerPost, t.saves),
      line("Sent on, per 1,000 reached", a.sendsPer1000, b.sendsPer1000, t.sendsPer1000),
      line("Profile visits per post", a.profileVisitsPerPost, b.profileVisitsPerPost, t.profileVisits),
    );
  }
  out.push(
    line("Site visits from Instagram", a.siteVisits, b.siteVisits, t.siteVisits),
    line("Messages received", a.messages, b.messages, t.messages),
    line("Comments from people", a.comments, b.comments),
    line("Briefs from Instagram visitors", a.briefs, b.briefs),
  );
  if (a.messages === 0 && a.briefs === 0) {
    out.push("<i>No message and no brief this week. Reach comes first, then profile visits, then messages: read the lines above in that order to see where it stops.</i>");
  }
  return out;
}
