// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// GET /api/admin/scraper-audit
//
// Retroactive audit per George 2026-04-20. Re-applies the Phase F
// scraper-spam heuristic against the last 14 days of auto-replies so
// we can quantify how many slipped through BEFORE the webhook filter
// shipped. Read-only — no cleanup.
//
// Returns JSON with:
//   - comment_replies: total auto-reply rows in window
//   - comment_replies_scraper_match: how many of those retro-match
//     the new heuristic (would have been skipped under Phase F)
//   - dm_replies_total / dm_replies_scraper_match: same for DMs
//   - followers_unknown: note (we don't store follower counts — the
//     <1000-follower split needs a separate Graph API backfill).

const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Duplicate of the webhook heuristic. Intentionally inline so this
// endpoint runs without pulling extra deps.
function isLikelyScraperSpam(
  commentText: string,
  commenterUsername: string | null,
): { scraper: boolean; reason?: string } {
  const text = (commentText ?? "").trim().toLowerCase();
  const user = (commenterUsername ?? "").toLowerCase();
  if (!text) return { scraper: false };

  const sendMePatterns = [
    /\bsend\s+(?:me|to\s+me)\s+(?:this|the\s+)?post\b/,
    /\bsend\s+it\s+to\s+me\b/,
    /\bdm\s+me\s+this\b/,
    /\bshare\s+(?:it|this)\s+to\s+me\b/,
    /\bcan\s+you\s+send\s+(?:me|this)\b/,
  ];
  for (const p of sendMePatterns) {
    if (p.test(text)) return { scraper: true, reason: "send-me-this" };
  }

  const oneWordProbes = ["price?", "info?", "link?", "cost?"];
  if (oneWordProbes.includes(text)) {
    return { scraper: true, reason: "one-word-probe" };
  }
  if (/^link\s+in\s+bio\s*\??$/i.test(text)) {
    return { scraper: true, reason: "redundant-link-in-bio" };
  }

  const botUserPatterns = [
    /_buzz$/,
    /_daily$/,
    /^travel_\w+_\d+$/,
    /^luxury_\w+_\w+$/,
    /^\w+_vibes(_\w+)?$/,
    /^\w+city_\w+$/,
    /\d{4,}$/,
  ];
  const botUserMatch = botUserPatterns.some((p) => p.test(user));
  if (botUserMatch) {
    const hypeOnly =
      text.length < 50 &&
      /^[\s❤️🤍🖤💕❤️‍🔥💯🔥✨🙌👏👌😍🤩💃😘😁😂❗❣️]+$|\b(?:beautiful|amazing|stunning|incredible|wow|gorgeous|lovely|perfect|nice)[\s.!❤️🔥✨👏]*$/i.test(
        text,
      );
    if (hypeOnly) return { scraper: true, reason: "botlike-username-hype" };
  }

  return { scraper: false };
}

export async function GET() {
  const sb = createServiceClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const [{ data: comments, error: cErr }, { data: dms, error: dErr }] = await Promise.all([
    sb
      .from("ig_comment_replies")
      .select("comment_id, commenter_username, comment_text, status, created_at")
      .gte("created_at", since)
      .limit(5000),
    sb
      .from("ig_dm_replies")
      .select("sender_id, message_text, intent, sent_at")
      .gte("sent_at", since)
      .limit(5000),
  ]);

  const commentRows = comments ?? [];
  const dmRows = dms ?? [];

  // Comments breakdown
  const commentTotal = commentRows.length;
  const commentAutoReplied = commentRows.filter(
    (r) => r.status !== "scraper_spam" && r.status !== "skipped",
  ).length; // rows that either already got a reply or were claimed but not yet status-flipped
  const commentScraperHits = commentRows.filter((r) => {
    const { scraper } = isLikelyScraperSpam(r.comment_text ?? "", r.commenter_username);
    return scraper;
  });
  const commentScraperReasons: Record<string, number> = {};
  for (const r of commentRows) {
    const res = isLikelyScraperSpam(r.comment_text ?? "", r.commenter_username);
    if (res.scraper) {
      const reason = res.reason ?? "unknown";
      commentScraperReasons[reason] = (commentScraperReasons[reason] ?? 0) + 1;
    }
  }

  // DMs: we don't store username on DM rows (only sender_id), so the
  // botlike-username heuristic is not applicable. The send-me-this
  // pattern still works against message_text.
  const dmTotal = dmRows.length;
  const dmScraperHits = dmRows.filter((r) => {
    const { scraper } = isLikelyScraperSpam(r.message_text ?? "", null);
    return scraper;
  });
  const dmScraperReasons: Record<string, number> = {};
  for (const r of dmRows) {
    const res = isLikelyScraperSpam(r.message_text ?? "", null);
    if (res.scraper) {
      const reason = res.reason ?? "unknown";
      dmScraperReasons[reason] = (dmScraperReasons[reason] ?? 0) + 1;
    }
  }

  // Sample 10 scraper hits so George can eyeball them.
  const commentSamples = commentScraperHits.slice(0, 10).map((r) => ({
    user: r.commenter_username,
    text: (r.comment_text ?? "").slice(0, 100),
    status: r.status,
    at: r.created_at,
  }));

  return NextResponse.json({
    window_days: 14,
    since,
    errors: { comments: cErr?.message ?? null, dms: dErr?.message ?? null },
    comments: {
      total: commentTotal,
      auto_replied_or_claimed: commentAutoReplied,
      retro_scraper_hits: commentScraperHits.length,
      retro_scraper_reasons: commentScraperReasons,
      samples: commentSamples,
    },
    dms: {
      total: dmTotal,
      retro_scraper_hits: dmScraperHits.length,
      retro_scraper_reasons: dmScraperReasons,
      followers_filter_note:
        "Follower count is not stored in ig_dm_replies. <1000-follower split needs Graph API backfill — separate task.",
    },
  });
}
