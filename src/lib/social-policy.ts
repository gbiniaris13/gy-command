// Which yachts may appear on an outward-facing channel.
//
// 2026-09-08 (George). Some yachts on georgeyachts.com are listed under a
// written permission that covers the website and nothing else: no social
// media, no B2B, no newsletter. Breaking that permission costs the
// relationship and invites a claim, so the rule cannot live in anyone's
// memory. It lives here, and it is enforced at the last moment before
// anything leaves for Instagram, Pinterest, LinkedIn, Facebook or TikTok.
//
// Three deliberate design choices:
//
// 1. ALLOWLIST, NOT BLOCKLIST. A yacht is publishable only if her slug is
//    on the list. A new yacht nobody remembered to classify is silent
//    rather than published. The cost of that mistake is one missed post;
//    the cost of the opposite mistake is the agreement.
//
// 2. THE LIST LIVES IN SUPABASE, NOT IN SANITY AND NOT IN THIS REPO.
//    Sanity's dataset is world-readable and this repository is public, so
//    a field or a constant here would tell anyone who looks which yachts
//    come from where, and from whom. The settings row is service-role
//    only. It also means the site's sitemap dates never move: writing a
//    flag onto every yacht document would have restamped the whole fleet
//    with today's date, which is the exact signal that cost us three
//    ranking pages in August.
//
// 3. FAILURE IS SILENCE. If the policy cannot be read, nothing publishes
//    and George is told. A quiet feed is recoverable. A breach is not.

import { createServiceClient } from "@/lib/supabase-server";

const SETTING_KEY = "yacht_social_policy_v1";
const CACHE_MS = 5 * 60 * 1000;

export type SocialPolicy = {
  allowed: string[];
  updatedAt?: string;
  note?: string;
};

type Cached = { at: number; policy: SocialPolicy | null };
let cache: Cached = { at: 0, policy: null };

/** Reads the policy. Returns null when it cannot be read: callers must treat null as "publish nothing". */
export async function loadSocialPolicy(): Promise<SocialPolicy | null> {
  if (cache.policy && Date.now() - cache.at < CACHE_MS) return cache.policy;
  try {
    const sb = createServiceClient();
    const { data, error } = await sb
      .from("settings")
      .select("value")
      .eq("key", SETTING_KEY)
      .maybeSingle();
    if (error || !data?.value) return null;
    const parsed = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
    const allowed = Array.isArray(parsed?.allowed)
      ? parsed.allowed.filter((s: unknown): s is string => typeof s === "string" && s.length > 0)
      : null;
    if (!allowed || allowed.length === 0) return null;
    const policy: SocialPolicy = {
      allowed: allowed.map((s: string) => s.trim().toLowerCase()),
      updatedAt: typeof parsed?.updated_at === "string" ? parsed.updated_at : undefined,
      note: typeof parsed?.note === "string" ? parsed.note : undefined,
    };
    cache = { at: Date.now(), policy };
    return policy;
  } catch {
    return null;
  }
}

/**
 * The single question every outward channel must ask.
 * Returns null when the yacht may be published, or a human-readable reason when it may not.
 */
export async function socialBlockReason(
  slug: string | null | undefined,
  channel: string,
): Promise<string | null> {
  const s = (slug ?? "").trim().toLowerCase();
  if (!s) return `no yacht slug supplied for ${channel}`;
  const policy = await loadSocialPolicy();
  if (!policy) return `yacht social policy unreadable, nothing publishes to ${channel}`;
  if (!policy.allowed.includes(s)) return `${s} is not cleared for ${channel}`;
  return null;
}

/** Filters a fleet down to the yachts cleared for outward channels. An unreadable policy yields an empty fleet. */
export async function filterSocialAllowed<T extends { slug?: string | null }>(
  yachts: T[],
): Promise<T[]> {
  const policy = await loadSocialPolicy();
  if (!policy) return [];
  const allowed = new Set(policy.allowed);
  return yachts.filter((y) => allowed.has((y.slug ?? "").trim().toLowerCase()));
}

/**
 * Library photos are named `sanity-<slug>-<n>.jpg` when they mirror a yacht's
 * Sanity gallery. Anything else (stock, studio, George's own) carries no yacht.
 */
export function yachtSlugFromFilename(filename: string | null | undefined): string | null {
  const f = (filename ?? "").trim().toLowerCase();
  const m = f.match(/^sanity-(.+?)-\d+\.(?:jpg|jpeg|png|webp)$/);
  return m ? m[1] : null;
}

/** Whether a yacht is missing from the policy entirely, so George can be told to classify her. */
export async function unclassifiedSlugs(slugs: string[]): Promise<string[]> {
  const policy = await loadSocialPolicy();
  if (!policy) return slugs;
  const allowed = new Set(policy.allowed);
  return slugs.filter((s) => !allowed.has(s.trim().toLowerCase()));
}
