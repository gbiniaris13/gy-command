"use client";

import { useState, useEffect } from "react";

interface IGPost {
  id: string;
  image_url: string;
  caption: string;
  schedule_time: string | null;
  status: string;
  published_at: string | null;
  error: string | null;
  created_at: string;
}

interface IGFeedPost {
  id: string;
  caption: string;
  media_type: string;
  media_url: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  draft: { bg: "bg-muted-blue/20", text: "text-muted-blue" },
  scheduled: { bg: "bg-electric-cyan/20", text: "text-electric-cyan" },
  publishing: { bg: "bg-amber/20", text: "text-amber" },
  published: { bg: "bg-emerald/20", text: "text-emerald" },
  failed: { bg: "bg-hot-red/20", text: "text-hot-red" },
};

interface IGAnalyticsPost {
  media_id: string;
  permalink: string | null;
  caption: string | null;
  media_type: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  published_at: string | null;
  fetched_at: string | null;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  profile_visits: number;
  total_interactions: number;
}

interface BestTimeSlot {
  day: number;
  day_name: string;
  hour: number;
  posts: number;
  avg_engagement_rate: number;
}

interface BestTimesResponse {
  slots: BestTimeSlot[];
  bestDay: { day_name: string; avg_engagement_rate: number; posts: number } | null;
  bestHour: { hour: number; avg_engagement_rate: number; posts: number } | null;
  sampleSize: number;
  minPosts: number;
  notReadyYet: boolean;
  timezone: string;
}

interface FollowerHistoryPoint {
  date: string;
  followers_count: number;
  follows_count: number | null;
  media_count: number | null;
}

interface FollowerDelta {
  from: number;
  to: number;
  change: number;
  pct: number | null;
}

interface FollowerHistoryResponse {
  history: FollowerHistoryPoint[];
  latest: FollowerHistoryPoint | null;
  delta1d: FollowerDelta | null;
  delta7d: FollowerDelta | null;
  delta30d: FollowerDelta | null;
}

function formatDelta(d: FollowerDelta | null): {
  text: string;
  positive: boolean;
} {
  if (!d) return { text: "—", positive: true };
  const sign = d.change > 0 ? "+" : "";
  const pct = d.pct == null ? "" : ` (${d.pct >= 0 ? "+" : ""}${d.pct}%)`;
  return { text: `${sign}${d.change}${pct}`, positive: d.change >= 0 };
}

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function hoursSince(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "< 1h";
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function InstagramClient() {
  const [posts, setPosts] = useState<IGPost[]>([]);
  const [feed, setFeed] = useState<IGFeedPost[]>([]);
  const [analytics, setAnalytics] = useState<IGAnalyticsPost[]>([]);
  const [bestTimes, setBestTimes] = useState<BestTimesResponse | null>(null);
  const [followerHistory, setFollowerHistory] =
    useState<FollowerHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // New post form
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("18:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/instagram/posts").then((r) => r.json()),
      fetch("/api/instagram/feed").then((r) => r.json()),
      fetch("/api/instagram/analytics").then((r) => r.json()),
      fetch("/api/instagram/best-times").then((r) => r.json()),
      fetch("/api/instagram/follower-history").then((r) => r.json()),
    ])
      .then(([postsData, feedData, analyticsData, bestTimesData, followerData]) => {
        setPosts(postsData.posts ?? []);
        setFeed(feedData.posts ?? []);
        setAnalytics(analyticsData.posts ?? []);
        setBestTimes(bestTimesData ?? null);
        setFollowerHistory(followerData ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(asScheduled: boolean) {
    setSaving(true);
    try {
      const body: Record<string, string | null> = {
        image_url: imageUrl,
        caption,
        schedule_time: null,
      };
      if (asScheduled && scheduleDate) {
        body.schedule_time = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
      }
      const res = await fetch("/api/instagram/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const newPost = await res.json();
        setPosts((p) => [newPost, ...p]);
        setImageUrl("");
        setCaption("");
        setScheduleDate("");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch("/api/instagram/posts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setPosts((p) => p.filter((post) => post.id !== id));
  }

  // Default schedule date to tomorrow
  useEffect(() => {
    const tomorrow = new Date(Date.now() + 86400000);
    setScheduleDate(tomorrow.toISOString().slice(0, 10));
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-1 inline-flex rounded border border-hot-red/30 bg-hot-red/10 px-2 py-0.5">
          <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[3px] text-hot-red uppercase">
            OPERATIONAL
          </span>
        </div>
        <h1 className="font-[family-name:var(--font-mono)] text-lg sm:text-2xl font-black tracking-[3px] text-electric-cyan uppercase">
          INSTAGRAM OPS
        </h1>
        <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-muted-blue tracking-wider uppercase">
          POST SCHEDULER — @GEORGEYACHTS
        </p>
      </div>

      {/* ── NEW TRANSMISSION ──────────────────────────────────── */}
      <div className="mb-6 glass-card p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-electric-cyan" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
            NEW TRANSMISSION
          </h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-wider text-muted-blue uppercase">
              IMAGE URL (public)
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-border-glow bg-glass-dark px-3 py-2.5 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
            />
          </div>

          <div>
            <label className="mb-1 flex items-center justify-between font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-wider text-muted-blue uppercase">
              CAPTION
              <span className="text-muted-blue/40">{caption.length}/2200</span>
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 2200))}
              rows={4}
              placeholder="Write caption..."
              className="w-full rounded-lg border border-border-glow bg-glass-dark px-3 py-2.5 font-[family-name:var(--font-mono)] text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none resize-none"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="mb-1 block font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-wider text-muted-blue uppercase">
                SCHEDULE DATE
              </label>
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="w-full rounded-lg border border-border-glow bg-glass-dark px-3 py-2.5 text-sm text-soft-white focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
              />
            </div>
            <div className="w-32">
              <label className="mb-1 block font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-wider text-muted-blue uppercase">
                TIME
              </label>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="w-full rounded-lg border border-border-glow bg-glass-dark px-3 py-2.5 text-sm text-soft-white focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleSave(false)}
              disabled={saving || !imageUrl}
              className="rounded-lg border border-border-glow px-4 py-2.5 font-[family-name:var(--font-mono)] text-xs font-bold tracking-wider text-muted-blue transition-colors hover:bg-glass-light hover:text-soft-white disabled:opacity-40 min-h-[44px]"
            >
              SAVE DRAFT
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving || !imageUrl || !scheduleDate}
              className="rounded-lg bg-electric-cyan/10 border border-electric-cyan/30 px-4 py-2.5 font-[family-name:var(--font-mono)] text-xs font-bold tracking-wider text-electric-cyan transition-colors hover:bg-electric-cyan/20 disabled:opacity-40 min-h-[44px]"
            >
              SCHEDULE POST
            </button>
          </div>
        </div>
      </div>

      {/* ── DEPLOYMENT QUEUE ─────────────────────────────────── */}
      <div className="mb-6 glass-card p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
            DEPLOYMENT QUEUE
          </h2>
          <span className="ml-auto font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
            {posts.filter((p) => p.status === "scheduled").length} SCHEDULED
          </span>
        </div>

        {loading ? (
          <p className="font-[family-name:var(--font-mono)] text-xs text-muted-blue/50">LOADING...</p>
        ) : posts.length === 0 ? (
          <p className="py-8 text-center font-[family-name:var(--font-mono)] text-xs text-muted-blue/40">
            NO POSTS IN QUEUE
          </p>
        ) : (
          <div className="space-y-2">
            {posts.map((post) => {
              const style = STATUS_STYLE[post.status] ?? STATUS_STYLE.draft;
              return (
                <div
                  key={post.id}
                  className="flex items-center gap-3 rounded-lg border border-border-glow bg-glass-light/20 px-3 py-3 min-h-[44px]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-[family-name:var(--font-mono)] text-sm text-soft-white">
                      {post.caption?.slice(0, 60) || "(no caption)"}
                      {(post.caption?.length ?? 0) > 60 ? "..." : ""}
                    </p>
                    <p className="font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
                      {post.schedule_time
                        ? new Date(post.schedule_time).toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "No date set"}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-wider uppercase ${style.bg} ${style.text}`}>
                    {post.status}
                  </span>
                  <button
                    onClick={() => handleDelete(post.id)}
                    className="shrink-0 rounded p-1.5 text-muted-blue/40 hover:text-hot-red transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                    title="Delete"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── PUBLISHED INTEL ───────────────────────────────────── */}
      <div className="glass-card p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
            PUBLISHED INTEL
          </h2>
          <span className="ml-auto font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
            LAST 10 POSTS
          </span>
        </div>

        {feed.length === 0 ? (
          <p className="py-8 text-center font-[family-name:var(--font-mono)] text-xs text-muted-blue/40">
            {loading ? "LOADING FEED..." : "NO POSTS FROM IG API"}
          </p>
        ) : (
          <div className="space-y-2">
            {feed.map((post) => (
              <div
                key={post.id}
                className="flex items-center gap-3 rounded-lg border border-border-glow bg-glass-light/20 px-3 py-3"
              >
                {post.media_url && (
                  <img
                    src={post.media_url}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-[family-name:var(--font-mono)] text-sm text-soft-white">
                    {post.caption?.slice(0, 50) || "(no caption)"}
                  </p>
                  <p className="font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
                    {timeAgo(post.timestamp)}
                  </p>
                </div>
                <div className="shrink-0 flex gap-3 font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/60">
                  <span title="Likes">&#10084; {post.like_count}</span>
                  <span title="Comments">&#128172; {post.comments_count}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── POST PERFORMANCE ──────────────────────────────────── */}
      <div className="glass-card p-4 sm:p-6 mt-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-neon-purple" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
            POST PERFORMANCE
          </h2>
          <span className="ml-auto font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
            LAST 7 DAYS · AUTO-SYNCED EVERY 6h
          </span>
        </div>

        {analytics.length === 0 ? (
          <p className="py-8 text-center font-[family-name:var(--font-mono)] text-xs text-muted-blue/40">
            {loading
              ? "LOADING ANALYTICS..."
              : "NO ANALYTICS YET — wait for the next cron tick or run /api/cron/instagram-analytics manually"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[11px]">
              <thead>
                <tr className="border-b border-border-glow text-left font-[family-name:var(--font-mono)] text-[9px] uppercase tracking-wider text-muted-blue/60">
                  <th className="py-2 pr-3">Post</th>
                  <th className="py-2 px-2 text-right">Age</th>
                  <th className="py-2 px-2 text-right">Reach</th>
                  <th className="py-2 px-2 text-right" title="Likes">❤</th>
                  <th className="py-2 px-2 text-right" title="Comments">💬</th>
                  <th className="py-2 px-2 text-right" title="Saves">🔖</th>
                  <th className="py-2 px-2 text-right" title="Shares">↗</th>
                  <th className="py-2 px-2 text-right" title="Profile visits">👤</th>
                  <th className="py-2 pl-2 text-right" title="Total interactions">Σ</th>
                </tr>
              </thead>
              <tbody className="font-[family-name:var(--font-mono)] text-muted-blue/80">
                {analytics.map((p) => {
                  const img = p.thumbnail_url || p.media_url;
                  const captionShort = (p.caption ?? "").slice(0, 60);
                  return (
                    <tr
                      key={p.media_id}
                      className="border-b border-border-glow/50 hover:bg-glass-light/10"
                    >
                      <td className="py-2 pr-3">
                        <a
                          href={p.permalink ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 min-w-0"
                        >
                          {img && (
                            <img
                              src={img}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded object-cover"
                            />
                          )}
                          <span className="truncate max-w-[260px] text-soft-white/90">
                            {captionShort || "(no caption)"}
                          </span>
                        </a>
                      </td>
                      <td className="py-2 px-2 text-right">
                        {hoursSince(p.published_at)}
                      </td>
                      <td className="py-2 px-2 text-right text-soft-white">
                        {formatCompact(p.reach)}
                      </td>
                      <td className="py-2 px-2 text-right">{formatCompact(p.likes)}</td>
                      <td className="py-2 px-2 text-right">{formatCompact(p.comments)}</td>
                      <td className="py-2 px-2 text-right">{formatCompact(p.saves)}</td>
                      <td className="py-2 px-2 text-right">{formatCompact(p.shares)}</td>
                      <td className="py-2 px-2 text-right">
                        {formatCompact(p.profile_visits)}
                      </td>
                      <td className="py-2 pl-2 text-right text-neon-purple">
                        {formatCompact(p.total_interactions)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── BEST TIME TO POST ─────────────────────────────────── */}
      <div className="glass-card p-4 sm:p-6 mt-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
            BEST TIME TO POST
          </h2>
          <span className="ml-auto font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
            FROM YOUR ENGAGEMENT HISTORY
          </span>
        </div>

        {!bestTimes ? (
          <p className="py-8 text-center font-[family-name:var(--font-mono)] text-xs text-muted-blue/40">
            {loading ? "ANALYSING POST HISTORY..." : "NO DATA YET"}
          </p>
        ) : bestTimes.notReadyYet ? (
          <div className="rounded-lg border border-amber/20 bg-amber/5 p-4">
            <p className="font-[family-name:var(--font-mono)] text-xs font-bold text-amber/80 uppercase tracking-wider">
              Need more posts to recommend reliably
            </p>
            <p className="mt-1 text-[11px] text-muted-blue/70">
              Got <span className="text-soft-white">{bestTimes.sampleSize}</span> tracked posts so far &middot; need at least{" "}
              <span className="text-soft-white">{bestTimes.minPosts}</span> for a useful recommendation. The cron pulls insights every 6h, so this fills in automatically as you keep posting.
            </p>
          </div>
        ) : (
          <>
            {/* Headline picks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {bestTimes.bestDay && (
                <div className="rounded-lg border border-emerald/20 bg-emerald/5 p-4">
                  <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-emerald/70">
                    Best day
                  </p>
                  <p className="mt-1 font-[family-name:var(--font-mono)] text-2xl font-bold text-soft-white">
                    {bestTimes.bestDay.day_name}
                  </p>
                  <p className="text-[10px] text-muted-blue/60">
                    {bestTimes.bestDay.avg_engagement_rate}% avg engagement &middot; {bestTimes.bestDay.posts} posts
                  </p>
                </div>
              )}
              {bestTimes.bestHour && (
                <div className="rounded-lg border border-amber/20 bg-amber/5 p-4">
                  <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-amber/70">
                    Best hour ({bestTimes.timezone})
                  </p>
                  <p className="mt-1 font-[family-name:var(--font-mono)] text-2xl font-bold text-soft-white">
                    {formatHour(bestTimes.bestHour.hour)}
                  </p>
                  <p className="text-[10px] text-muted-blue/60">
                    {bestTimes.bestHour.avg_engagement_rate}% avg engagement &middot; {bestTimes.bestHour.posts} posts
                  </p>
                </div>
              )}
            </div>

            {/* Top slot list */}
            <p className="mb-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-muted-blue/60">
              Top {bestTimes.slots.length} slots
            </p>
            <div className="space-y-2">
              {bestTimes.slots.map((s, i) => {
                const max = bestTimes.slots[0]?.avg_engagement_rate || 1;
                const widthPct = max > 0 ? (s.avg_engagement_rate / max) * 100 : 0;
                return (
                  <div
                    key={`${s.day}-${s.hour}`}
                    className="flex items-center gap-3"
                  >
                    <span className="w-6 shrink-0 text-right font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/40">
                      #{i + 1}
                    </span>
                    <span className="w-28 shrink-0 font-[family-name:var(--font-mono)] text-[11px] text-soft-white/80">
                      {s.day_name} {formatHour(s.hour)}
                    </span>
                    <div className="relative h-4 flex-1 rounded bg-glass-light/30">
                      <div
                        className="absolute inset-y-0 left-0 rounded bg-amber/60"
                        style={{ width: `${Math.max(widthPct, 4)}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right font-[family-name:var(--font-mono)] text-[11px] text-amber">
                      {s.avg_engagement_rate}%
                    </span>
                    <span className="w-12 shrink-0 text-right font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/40">
                      {s.posts}p
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[10px] text-muted-blue/40">
              Engagement rate = total interactions / reach. Buckets refresh as the analytics cron pulls new posts every 6h.
            </p>
          </>
        )}
      </div>

      {/* ── FOLLOWER GROWTH ───────────────────────────────────── */}
      <div className="glass-card p-4 sm:p-6 mt-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-electric-cyan" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
            FOLLOWER GROWTH
          </h2>
          <span className="ml-auto font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
            DAILY SNAPSHOT
          </span>
        </div>

        {!followerHistory || followerHistory.history.length === 0 ? (
          <p className="py-8 text-center font-[family-name:var(--font-mono)] text-xs text-muted-blue/40">
            {loading
              ? "LOADING FOLLOWER HISTORY..."
              : "NO SNAPSHOTS YET — wait for the next 03:11 UTC cron tick or hit /api/cron/instagram-followers manually"}
          </p>
        ) : (
          <>
            {/* Headline tiles */}
            <div className="mb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-white/5 bg-glass-light/20 p-4">
                <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-muted-blue/60">
                  Followers
                </p>
                <p className="mt-1 font-[family-name:var(--font-mono)] text-2xl font-bold text-soft-white">
                  {(followerHistory.latest?.followers_count ?? 0).toLocaleString("en-US")}
                </p>
                <p className="text-[10px] text-muted-blue/40">
                  {followerHistory.latest?.date ?? "—"}
                </p>
              </div>
              {(["delta1d", "delta7d", "delta30d"] as const).map((key) => {
                const d = followerHistory[key];
                const f = formatDelta(d);
                const label =
                  key === "delta1d" ? "vs yesterday" : key === "delta7d" ? "vs 7d ago" : "vs 30d ago";
                return (
                  <div
                    key={key}
                    className="rounded-lg border border-white/5 bg-glass-light/20 p-4"
                  >
                    <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-muted-blue/60">
                      {label}
                    </p>
                    <p
                      className={`mt-1 font-[family-name:var(--font-mono)] text-2xl font-bold ${
                        f.positive ? "text-emerald" : "text-hot-red"
                      }`}
                    >
                      {f.text}
                    </p>
                    <p className="text-[10px] text-muted-blue/40">
                      {d ? `from ${d.from.toLocaleString("en-US")}` : "needs more snapshots"}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Sparkline (no chart lib — inline SVG) */}
            {followerHistory.history.length >= 2 ? (
              <div className="rounded-lg border border-white/5 bg-glass-light/10 p-4">
                <FollowerSparkline history={followerHistory.history} />
              </div>
            ) : (
              <p className="rounded-lg border border-white/5 bg-glass-light/10 p-4 text-center text-[11px] text-muted-blue/50">
                Need at least 2 daily snapshots to render the trend line — chart fills in automatically.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── FollowerSparkline (inline SVG so we don't pull in a chart lib) ────────
function FollowerSparkline({ history }: { history: FollowerHistoryPoint[] }) {
  const W = 760;
  const H = 140;
  const PAD_X = 30;
  const PAD_Y = 16;

  const counts = history.map((p) => p.followers_count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const range = Math.max(max - min, 1);
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  const points = history.map((p, i) => {
    const x =
      history.length === 1
        ? PAD_X + innerW / 2
        : PAD_X + (i / (history.length - 1)) * innerW;
    const y = PAD_Y + innerH - ((p.followers_count - min) / range) * innerH;
    return { x, y, count: p.followers_count, date: p.date };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const areaPath =
    `M ${points[0].x.toFixed(1)} ${(H - PAD_Y).toFixed(1)} ` +
    points
      .map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ") +
    ` L ${points[points.length - 1].x.toFixed(1)} ${(H - PAD_Y).toFixed(1)} Z`;

  const firstDate = history[0].date;
  const lastDate = history[history.length - 1].date;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
      <defs>
        <linearGradient id="follower-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(0 217 255 / 0.4)" />
          <stop offset="100%" stopColor="rgb(0 217 255 / 0)" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#follower-grad)" />
      <path
        d={linePath}
        fill="none"
        stroke="rgb(0 217 255)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2} fill="rgb(0 217 255)">
          <title>{`${p.date}: ${p.count.toLocaleString("en-US")}`}</title>
        </circle>
      ))}
      <text
        x={PAD_X}
        y={H - 2}
        fontSize="10"
        fill="rgba(255,255,255,0.4)"
        fontFamily="monospace"
      >
        {firstDate}
      </text>
      <text
        x={W - PAD_X}
        y={H - 2}
        textAnchor="end"
        fontSize="10"
        fill="rgba(255,255,255,0.4)"
        fontFamily="monospace"
      >
        {lastDate}
      </text>
      <text
        x={W - PAD_X}
        y={PAD_Y - 4}
        textAnchor="end"
        fontSize="10"
        fill="rgba(255,255,255,0.4)"
        fontFamily="monospace"
      >
        {max.toLocaleString("en-US")}
      </text>
      <text
        x={W - PAD_X}
        y={H - PAD_Y + 12}
        textAnchor="end"
        fontSize="10"
        fill="rgba(255,255,255,0.4)"
        fontFamily="monospace"
      >
        {min.toLocaleString("en-US")}
      </text>
    </svg>
  );
}
