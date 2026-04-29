// Daily IG engagement-DM cron — 08:00 UTC (11:00 Athens).
//
// Pulls IG accounts who recently engaged with @georgeyachts (comments,
// mentions, tagged media), classifies each via Gemini into one of 3
// outreach archetypes (travel_advisor / uhnw_potential / yacht_industry),
// drafts a 10/10 personalized first-touch DM using George's brief from
// 26/04 (Type A/B/C templates), and pushes drafts to Telegram for
// one-tap manual send via the IG mobile app.
//
// Hard daily cap: 5 DMs/day max — quality over volume. Already-DM'd
// usernames are persisted in settings.ig_dm_sent_usernames and skipped.
//
// We deliberately don't auto-send via IG Messaging API for the first
// 30 days — quality safeguard. George reviews + sends each. Once we
// trust the classification + draft quality, we flip to auto-send.
//
// Also pushes followers count delta in the same Telegram message so
// George knows total daily reach growth even though the API doesn't
// expose individual follower usernames.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import {
  fetchRecentEngagement,
  classifyCandidate,
  draftDm,
  getDmSentSet,
  recordDmSent,
  getFollowersDelta,
  type DmCategory,
} from "@/lib/ig-engagement-dm";
import { observeCron } from "@/lib/cron-observer";

export const runtime = "nodejs";
export const maxDuration = 300;

// Raised from 5 → 10 (2026-04-29) per George's feedback that he was
// "βλέπω 4-5 ανθρώπους" each day — too few drafts to land a meaningful
// outbound rhythm. The candidate pool widened with the /tags signal
// (commit 709a939) so the supply side now supports the higher cap.
// Resend / IG send-rate is unchanged because each DM is still George
// hitting Send manually from the Telegram digest.
const DAILY_DM_CAP = 10;

const CATEGORY_BADGE: Record<DmCategory, string> = {
  travel_advisor: "🎯 Travel Advisor",
  uhnw_potential: "💎 UHNW potential",
  yacht_industry: "⚓ Yacht Industry",
  unknown: "❓ Unknown",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function _observedImpl(): Promise<Response> {
  const sb = createServiceClient();
  const igToken = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_BUSINESS_ID || process.env.IG_USER_ID;

  if (!igToken || !igUserId) {
    return NextResponse.json(
      { error: "IG_ACCESS_TOKEN or IG_BUSINESS_ID not configured" },
      { status: 500 },
    );
  }

  try {
    // 1. Followers count delta
    let followersToday = 0;
    let followersDelta: number | null = null;
    try {
      const fd = await getFollowersDelta(sb, igUserId, igToken);
      followersToday = fd.today;
      followersDelta = fd.delta;
    } catch (e) {
      console.error("[ig-engagement-dm] followers delta failed:", e);
    }

    // 2. Pull engagement candidates (comments + mentions last 30d)
    const candidates = await fetchRecentEngagement(igUserId, igToken, 30);

    // 3. Filter: dedup against already-DM'd, drop low-quality, drop our own
    const sent = await getDmSentSet(sb);
    const fresh = candidates.filter((c) => {
      const u = c.username.toLowerCase();
      if (sent.has(u)) return false;
      if (u === "georgeyachts") return false;
      if (c.followerCount > 0 && c.followerCount < 100) return false; // bot-ish
      return true;
    });

    // 4. Classify + draft per candidate, capped at DAILY_DM_CAP
    const drafts: {
      username: string;
      fullName: string | null;
      category: DmCategory;
      followerCount: number;
      bio: string | null;
      signal: string;
      draft_text: string;
    }[] = [];

    for (const c of fresh) {
      if (drafts.length >= DAILY_DM_CAP) break;
      const category = await classifyCandidate(c);
      if (category === "unknown") continue;
      const draft = await draftDm(c, category);
      if (!draft) continue;
      drafts.push({
        username: c.username,
        fullName: c.fullName,
        category,
        followerCount: c.followerCount,
        bio: c.bio,
        signal: `${c.signal}: ${c.signalContext.slice(0, 100)}`,
        draft_text: draft,
      });
      // Optimistic record so we never DM twice even if Telegram push fails
      await recordDmSent(sb, c.username);
    }

    // 5. Push to Telegram
    const date = new Date().toISOString().slice(0, 10);
    const lines: string[] = [
      `📱 <b>IG Engagement Scan — ${date}</b>`,
      ``,
    ];

    if (followersDelta !== null) {
      const sign = followersDelta > 0 ? "+" : "";
      lines.push(
        `<b>Followers</b>: ${followersToday.toLocaleString()} (${sign}${followersDelta} σε 24h)`,
        ``,
      );
    } else if (followersToday > 0) {
      lines.push(
        `<b>Followers</b>: ${followersToday.toLocaleString()} (delta: first snapshot)`,
        ``,
      );
    }

    // Signal-source breakdown (added 2026-04-29). Lets George see at a
    // glance whether the new /tags signal is producing alongside the
    // legacy comments + mentions paths.
    const sigCount: Record<string, number> = {};
    for (const c of candidates) {
      const k = (c.signal || "other").toLowerCase();
      sigCount[k] = (sigCount[k] ?? 0) + 1;
    }
    const sigParts = Object.entries(sigCount)
      .sort((a, b) => b[1] - a[1])
      .map(([sig, n]) => `${sig}: ${n}`)
      .join(" · ");

    lines.push(
      `<b>Engagement candidates scanned</b>: ${candidates.length}`,
      ...(sigParts ? [`<i>Sources</i>: ${sigParts}`] : []),
      `<b>Already DM'd (skipped)</b>: ${candidates.length - fresh.length}`,
      `<b>Drafts ready</b>: ${drafts.length}`,
      ``,
    );

    if (drafts.length === 0) {
      lines.push(
        `<i>Καμία νέα ποιοτική engagement σήμερα. IG silent ή ήδη τους έχεις DM'άρει όλους. Note: το IG Graph API δεν εκθέτει "νέοι followers" list — δουλεύουμε με comments + mentions, αξιόπιστο σήμα ποιότητας.</i>`,
      );
    } else {
      lines.push(`<b>📨 Drafts (1-tap send via IG mobile app):</b>`, ``);
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        const igUrl = `https://instagram.com/${d.username}`;
        const dmUrl = `https://ig.me/m/${d.username}`;
        lines.push(
          `<b>${i + 1}. @${escapeHtml(d.username)}</b> ${d.fullName ? `· ${escapeHtml(d.fullName)}` : ""}`,
          `${CATEGORY_BADGE[d.category]} · ${d.followerCount.toLocaleString()} followers`,
          `<i>Surfaced via:</i> ${escapeHtml(d.signal.slice(0, 120))}`,
          ``,
          `<b>DM draft:</b>`,
          `<code>${escapeHtml(d.draft_text)}</code>`,
          ``,
          `<a href="${dmUrl}">→ Open DM</a> · <a href="${igUrl}">→ View profile</a>`,
          ``,
          `─────────────`,
          ``,
        );
      }
      lines.push(
        `<i>👉 Πατάς "Open DM", paste το draft, send. ~15 sec/μήνυμα. Hard cap 5/μέρα — quality over volume.</i>`,
      );
    }

    await sendTelegram(lines.join("\n")).catch(() => {});

    // 6. Persist briefing for dashboard surfacing
    await sb.from("settings").upsert({
      key: `ig_engagement_dm_${date}`,
      value: JSON.stringify({
        followers_today: followersToday,
        followers_delta: followersDelta,
        candidates_count: candidates.length,
        drafts: drafts,
        generated_at: new Date().toISOString(),
      }),
    });

    return NextResponse.json({
      ok: true,
      candidates_scanned: candidates.length,
      drafts_ready: drafts.length,
      followers_today: followersToday,
      followers_delta: followersDelta,
    });
  } catch (e: any) {
    console.error("[ig-engagement-dm] FAILED:", e);
    await sendTelegram(
      `⚠️ <b>IG engagement-DM cron crashed</b>\n<code>${(e?.message ?? "unknown").slice(0, 300)}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}

export async function GET(): Promise<Response> {
  return observeCron("ig-engagement-dm", _observedImpl);
}
