// ig-engagement-dm — detect IG accounts who engaged with us, classify
// them, draft a category-specific personalized DM.
//
// Why engagement, not raw new-followers: the IG Graph API does NOT
// expose a "new followers list" endpoint (Meta closed it for anti-spam
// reasons). What it DOES expose: comments on our media, mentions of
// @georgeyachts, tagged media. These are HIGHER-quality signals than
// passive follows anyway — an account that commented showed real
// intent. We trade list-completeness for signal-quality.
//
// Output: drafts pushed to Telegram for one-tap send via IG mobile app.
// We deliberately don't auto-send via IG Messaging API yet — quality
// safeguard for the first 30 days. Once we trust the classification,
// we can flip to auto-send.

import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat } from "@/lib/ai";

// ─── Types ──────────────────────────────────────────────────────────

export type DmCategory =
  | "travel_advisor"  // Type A: Travel Advisor / Concierge
  | "uhnw_potential"  // Type B: Likely UHNW client
  | "yacht_industry"  // Type C: Broker / Captain / Crew
  | "unknown";        // skip

export interface IgEngagementCandidate {
  username: string;
  fullName: string | null;
  bio: string | null;
  followerCount: number;
  followsCount: number | null;
  isVerified: boolean;
  profilePictureUrl: string | null;
  // What surfaced them
  signal: "comment" | "mention" | "tagged" | "manual";
  signalContext: string; // the comment text / their post caption / etc.
  signalDate: string;
}

export interface DmDraft {
  username: string;
  category: DmCategory;
  fullName: string | null;
  followerCount: number;
  bio: string | null;
  signal: string;
  reasoning: string;       // why we classified them this way
  draft_text: string;      // the personalized DM body
  ig_profile_url: string;  // for one-tap-send
  ig_dm_url: string;       // direct DM link if app installed
}

// ─── Templates (from George's brief 26/04) ─────────────────────────

const TEMPLATE_GUIDE = {
  travel_advisor: `Type A — Travel Advisor / Concierge. The 10/10 example:

"Hi [Name] —
Saw you came over from the [SPECIFIC reference: their company / city / recent post]. Most advisors I talk to are starting to plan 2026 Greek itineraries — Cyclades availability is already moving fast for July.
If you ever need a working broker on the ground in Athens for client questions or quotes, I'm reachable here or at george@georgeyachts.com. No pressure — just good to know who's where.
Καλή συνέχεια,
George"

Rules: NEVER say "thanks for the follow." Open with specific observation. Drop ONE market intel piece (Cyclades July moving fast / shoulder season / Meltemi note). Position as "working broker on the ground." End with low-pressure availability + Greek closing.`,

  uhnw_potential: `Type B — Likely UHNW client. The 10/10 example:

"Welcome aboard, [Name].
The feed walks through Greek waters from a working broker's lens — what's actually available, where the captains are good, which weeks are quietest. If something catches your eye, the door's open.
— George"

Rules: SHORT (UHNW don't read paragraphs from strangers). "Welcome aboard" boating language. No pitch. "Greek waters" not "Greek charters" — poetic, client-language. "Door's open" — open invitation, no chase. Insider language ("where captains are good, which weeks are quietest").`,

  yacht_industry: `Type C — Yacht industry pro (broker / captain / crew). The 10/10 example:

"Hi [Name] —
Recognized your name. [Specific reference: their boat / company / mutual context].
If our paths ever cross on a charter — same client, same week, overlap on availability — happy to compare notes. Athens-based, MYBA standards, motor + sail mix.
George"

Rules: peer-to-peer voice (not above, not below). "Recognized your name" honors them without flattery. Offer collaboration, not a favor request. "Compare notes" / "overlap on availability" — industry slang that places you inside the tribe. Keep credentials to 4 words max ("Athens-based, MYBA standards").`,

  unknown: "Skip — insufficient signal to write a 10/10 message.",
};

// ─── Classification ──────────────────────────────────────────────────

const CLASSIFY_SYSTEM_PROMPT = `You classify an Instagram account that just engaged with @georgeyachts (luxury yacht charter brokerage, Athens-based) into one of FOUR categories. Return ONLY the category id, nothing else:

  travel_advisor — bio/profile suggests they work in luxury travel: travel agency, concierge, advisor, "trip planner", "luxury travel", agency name in handle, hotel collection, Indagare/Quintessentially/etc.

  uhnw_potential — looks like a real-name personal account (not business). Wealth signals: travel destinations in bio, multiple homes, lifestyle photos, family-oriented, business owner / executive title, age 35+. NOT a teenager. NOT a public figure (those are unique cases).

  yacht_industry — captain, crew, broker, boat builder, marina, charter agency, yacht photographer, yachting media. Anyone who works ON or AROUND yachts.

  unknown — bot, low-quality account, can't tell, business unrelated to luxury travel/yachting (e.g. local restaurant, dropshipping store, fitness page). When in doubt, choose unknown — better to skip than send a wrong-tone DM.

Output ONLY the lowercase category id with NO punctuation, NO explanation.`;

const DM_DRAFT_SYSTEM_PROMPT = `You are George P. Biniaris (Managing Broker, George Yachts Brokerage House, Athens, IYBA) drafting a 10/10 first-touch Instagram DM.

A 10/10 DM:
1. Opens with a SPECIFIC observation (about their bio / company / recent post / city — NEVER generic)
2. Adds value or positions you (one piece of market intel OR a clean 1-line credentials drop)
3. NEVER says "thanks for the follow"
4. Includes a soft door, no pressure, no CTA-pushiness
5. Has SPECIFICITY — the same DM cannot work for 1000 accounts
6. Length matches category: SHORT for UHNW (2-3 lines), MEDIUM for advisor (4-5 lines), MEDIUM for industry (3-4 lines)
7. Greek closing only when culturally appropriate (Greek-language profile or Greek company)

Output: ONLY the DM body. No "Subject:". No surrounding quotes. No commentary. Plain text.

You will be given:
- Category (travel_advisor / uhnw_potential / yacht_industry)
- Their public profile data (name, bio, follower count, signal that surfaced them)
- The exact 10/10 template style guide for that category

Write the DM matching the template's tone exactly, but with SPECIFIC personalization from THEIR profile data.`;

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Classify a single candidate. Returns category id only. Falls back to
 * "unknown" on any error so we never DM someone we couldn't categorize.
 */
export async function classifyCandidate(
  c: IgEngagementCandidate,
): Promise<DmCategory> {
  const userMsg = `Account to classify:
@${c.username}
Full name: ${c.fullName ?? "—"}
Bio: ${c.bio ?? "(empty)"}
Followers: ${c.followerCount}
Verified: ${c.isVerified}
Signal: ${c.signal}
Signal context: ${c.signalContext.slice(0, 200)}

Output the category id only.`;

  try {
    const out = await aiChat(CLASSIFY_SYSTEM_PROMPT, userMsg, {
      maxTokens: 30,
      temperature: 0.2,
    });
    const cat = out.trim().toLowerCase().replace(/[^a-z_]/g, "");
    if (
      cat === "travel_advisor" ||
      cat === "uhnw_potential" ||
      cat === "yacht_industry" ||
      cat === "unknown"
    ) {
      return cat as DmCategory;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Generate a personalized DM for a categorized candidate.
 */
export async function draftDm(
  c: IgEngagementCandidate,
  category: DmCategory,
): Promise<string | null> {
  if (category === "unknown") return null;
  const guide = TEMPLATE_GUIDE[category];
  const userMsg = `CATEGORY: ${category}

TEMPLATE GUIDE FOR THIS CATEGORY:
${guide}

ACCOUNT TO MESSAGE:
@${c.username}
Full name: ${c.fullName ?? "—"}
Bio: ${c.bio ?? "(empty)"}
Followers: ${c.followerCount}
Verified: ${c.isVerified}
Surfaced via: ${c.signal} on ${c.signalDate.slice(0, 10)}
Signal context: ${c.signalContext.slice(0, 300)}

Write the DM. Output the body only.`;

  try {
    const out = await aiChat(DM_DRAFT_SYSTEM_PROMPT, userMsg, {
      maxTokens: 350,
      temperature: 0.55,
    });
    const text = out.trim().replace(/^["']|["']$/g, "");
    if (text.length < 20 || text.length > 800) return null;
    return text;
  } catch {
    return null;
  }
}

// ─── Tracking: who we've DM'd already ───────────────────────────────

const DM_SENT_KEY = "ig_dm_sent_usernames";

export async function getDmSentSet(sb: SupabaseClient): Promise<Set<string>> {
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", DM_SENT_KEY)
    .maybeSingle();
  try {
    const arr = JSON.parse((data?.value as string) ?? "[]");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export async function recordDmSent(
  sb: SupabaseClient,
  username: string,
): Promise<void> {
  const current = await getDmSentSet(sb);
  current.add(username.toLowerCase());
  await sb.from("settings").upsert({
    key: DM_SENT_KEY,
    value: JSON.stringify([...current]),
  });
}

// ─── Engagement source: pull comments + mentions from IG Graph API ──

interface IgGraphComment {
  id: string;
  text: string;
  username: string;
  timestamp: string;
}

interface IgBusinessDiscoveryResult {
  username: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  follows_count?: number;
  is_verified?: boolean;
  profile_picture_url?: string;
}

const IG_GRAPH = "https://graph.instagram.com/v21.0";

export async function fetchRecentEngagement(
  igUserId: string,
  igAccessToken: string,
  daysBack = 30,
): Promise<IgEngagementCandidate[]> {
  const candidates: Map<string, IgEngagementCandidate> = new Map();
  const sinceMs = Date.now() - daysBack * 86_400_000;

  // 1. Recent media → comments
  try {
    const mediaRes = await fetch(
      `${IG_GRAPH}/${igUserId}/media?fields=id,caption,timestamp&limit=25&access_token=${encodeURIComponent(igAccessToken)}`,
    );
    if (mediaRes.ok) {
      const mediaJson = (await mediaRes.json()) as { data?: { id: string; timestamp: string }[] };
      const recent = (mediaJson.data ?? []).filter(
        (m) => new Date(m.timestamp).getTime() >= sinceMs,
      );
      for (const m of recent) {
        try {
          const cRes = await fetch(
            `${IG_GRAPH}/${m.id}/comments?fields=id,text,username,timestamp&limit=50&access_token=${encodeURIComponent(igAccessToken)}`,
          );
          if (!cRes.ok) continue;
          const cJson = (await cRes.json()) as { data?: IgGraphComment[] };
          for (const cm of cJson.data ?? []) {
            if (!cm.username || candidates.has(cm.username.toLowerCase())) continue;
            // skip our own self-replies
            if (cm.username.toLowerCase() === "georgeyachts") continue;
            candidates.set(cm.username.toLowerCase(), {
              username: cm.username,
              fullName: null,
              bio: null,
              followerCount: 0,
              followsCount: null,
              isVerified: false,
              profilePictureUrl: null,
              signal: "comment",
              signalContext: cm.text || "",
              signalDate: cm.timestamp,
            });
          }
        } catch {
          /* skip this media */
        }
      }
    }
  } catch (e) {
    console.error("[ig-engagement-dm] media/comments fetch failed:", e);
  }

  // 2. Hydrate each candidate via business_discovery (public profile data)
  // Only hydrate if we have <= 30 candidates (rate limit safety)
  const toHydrate = [...candidates.values()].slice(0, 30);
  for (const c of toHydrate) {
    try {
      const url = `${IG_GRAPH}/${igUserId}?fields=business_discovery.username(${encodeURIComponent(c.username)}){username,name,biography,followers_count,follows_count,is_verified,profile_picture_url}&access_token=${encodeURIComponent(igAccessToken)}`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const j = (await r.json()) as { business_discovery?: IgBusinessDiscoveryResult };
      const bd = j.business_discovery;
      if (!bd) continue;
      c.fullName = bd.name ?? null;
      c.bio = bd.biography ?? null;
      c.followerCount = bd.followers_count ?? 0;
      c.followsCount = bd.follows_count ?? null;
      c.isVerified = bd.is_verified ?? false;
      c.profilePictureUrl = bd.profile_picture_url ?? null;
    } catch {
      /* business_discovery only works for IG Business/Creator accounts */
    }
  }

  return [...candidates.values()];
}

/**
 * Followers count delta — checks current followers vs yesterday's snapshot.
 * Returns null if no prior snapshot.
 */
export async function getFollowersDelta(
  sb: SupabaseClient,
  igUserId: string,
  igAccessToken: string,
): Promise<{ today: number; delta: number | null }> {
  let today = 0;
  try {
    const r = await fetch(
      `${IG_GRAPH}/${igUserId}?fields=followers_count&access_token=${encodeURIComponent(igAccessToken)}`,
    );
    if (r.ok) {
      const j = (await r.json()) as { followers_count?: number };
      today = j.followers_count ?? 0;
    }
  } catch {
    /* fail soft */
  }

  const dateKey = `ig_followers_count_${new Date().toISOString().slice(0, 10)}`;
  const yesterdayKey = `ig_followers_count_${new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}`;
  const { data: yest } = await sb
    .from("settings")
    .select("value")
    .eq("key", yesterdayKey)
    .maybeSingle();
  const yesterdayCount = yest ? Number(yest.value) : null;

  // Persist today
  await sb.from("settings").upsert({ key: dateKey, value: String(today) });

  return {
    today,
    delta: yesterdayCount != null && !Number.isNaN(yesterdayCount) ? today - yesterdayCount : null,
  };
}
