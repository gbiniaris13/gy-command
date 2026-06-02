// src/lib/greetings.ts
// =============================================================
// Shared helpers for the auto-greeting engine (birthdays +
// holidays + anniversary). Brief 06 / after-sales STEP 3A.
//
//   - unsubscribeToken / verify : signed, non-guessable one-click
//     opt-out token (HMAC-SHA256). No login required.
//   - optOutFooter              : the plain-text footer appended to
//     EVERY greeting body so every comms path carries opt-out.
//   - recentGreeting            : frequency-cap lookup (was this
//     contact greeted in the last N days?).
//   - OCCASION_PRIORITY         : birthday > anniversary > holiday
//     > new_year, for same-day collision resolution.
//
// We send from Gmail (not Resend) so there is no native
// List-Unsubscribe header path; this is our own one-click link.
// =============================================================

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const BASE =
  process.env.NEXT_PUBLIC_SITE_URL || "https://command.georgeyachts.com";

// HMAC key. Reuses CRON_SECRET (server-only, identical on the cron
// that signs and the endpoint that verifies) so no new env var is
// required for the feature to work. GREETINGS_SECRET overrides if set.
const SECRET =
  process.env.GREETINGS_SECRET || process.env.CRON_SECRET || "gy-greetings-dev";

function sign(id: string): string {
  return createHmac("sha256", SECRET).update(id).digest("base64url");
}

export function unsubscribeToken(contactId: string): string {
  return `${contactId}.${sign(contactId)}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const id = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? id : null;
}

export function unsubscribeUrl(contactId: string): string {
  return `${BASE}/greetings/unsubscribe?token=${encodeURIComponent(
    unsubscribeToken(contactId),
  )}`;
}

// ─── Tier-aware footer (Filotimo Circle) ─────────────────────────
// The tier lives in filotimo_circle_members.tier (friend/companion/
// crewmate), person-scoped by email. The footer names the tier; an
// unknown/missing tier falls back to a neutral phrase. Never blank,
// never a wrong tier.
export function tierPhrase(tier: string | null | undefined): string {
  const map: Record<string, string> = {
    friend: "a Friend",
    companion: "a Companion",
    crewmate: "a Crewmate",
  };
  const who = tier && map[tier] ? map[tier] : null;
  return who
    ? `as ${who} of the Filotimo Circle`
    : "as part of the Filotimo Circle";
}

// Look up a contact's Filotimo tier by email. Null if they are not a
// Circle member (footer then uses the neutral fallback).
export async function getTier(
  sb: SupabaseClient,
  email: string | null | undefined,
): Promise<string | null> {
  if (!email) return null;
  const { data } = await sb
    .from("filotimo_circle_members")
    .select("tier")
    .ilike("email", email.trim())
    .is("deleted_at", null)
    .maybeSingle();
  return (data?.tier as string) ?? null;
}

// Plain-text footer. No dashes used as separators (house rule: no
// em dash, and we avoid the "--" double-hyphen too).
export function optOutFooter(contactId: string, tier?: string | null): string {
  return (
    `\n\nYou are receiving this occasional note ${tierPhrase(tier)}.` +
    `\nIf you would prefer not to, unsubscribe in one click: ${unsubscribeUrl(contactId)}`
  );
}

// ─── Name sanitization ────────────────────────────────────────────
// Proper-case a raw first name: "tricia" -> "Tricia", "TRICIA" ->
// "Tricia", "mary-jane" -> "Mary-Jane", "o'brien" -> "O'Brien".
// Handles Latin + Greek letters.
export function properCaseName(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  return s
    .toLocaleLowerCase()
    .replace(/(^|[\s'’\-])(\p{L})/gu, (_m, sep: string, ch: string) =>
      sep + ch.toLocaleUpperCase(),
    );
}

// First-name for a salutation, with a graceful fallback so a client
// is NEVER greeted "Dear ," when first_name is blank/null.
// Empty -> "friend"  =>  "Dear friend,"
export function greetingName(raw: string | null | undefined): string {
  return properCaseName(raw) || "friend";
}

// ─── Frequency cap ────────────────────────────────────────────────
// Greeting occasions we count toward the 5-day cap. Tagged in
// activities.metadata.occasion by every greeting cron.
export const GREETING_OCCASIONS = [
  "birthday",
  "anniversary",
  "holiday",
  "new_year",
  "name_day",
] as const;

// Higher = more important. Used to pick ONE greeting when several
// land on the same day for the same contact.
export const OCCASION_PRIORITY: Record<string, number> = {
  birthday: 4,
  anniversary: 3,
  holiday: 2,
  name_day: 2,
  new_year: 1,
};

export interface RecentGreeting {
  occasion: string;
  created_at: string;
}

// Returns the most recent greeting sent to this contact within
// `withinDays`, or null. Used to enforce "max one greeting per
// contact per rolling 5 days" (whichever occasion comes first wins).
export async function recentGreeting(
  sb: SupabaseClient,
  contactId: string,
  withinDays = 5,
): Promise<RecentGreeting | null> {
  const since = new Date(Date.now() - withinDays * 86400000).toISOString();
  const { data } = await sb
    .from("activities")
    .select("created_at, metadata")
    .eq("contact_id", contactId)
    .eq("type", "email_sent")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(25);
  for (const a of (data ?? []) as { created_at: string; metadata: Record<string, unknown> | null }[]) {
    const occ = a?.metadata?.occasion;
    if (typeof occ === "string" && (GREETING_OCCASIONS as readonly string[]).includes(occ)) {
      return { occasion: occ, created_at: a.created_at };
    }
  }
  return null;
}
