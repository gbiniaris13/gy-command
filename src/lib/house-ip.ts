// src/lib/house-ip.ts
// 2026-11-06 — George's own network never counts as a client.
//
// George: "όταν ανοίγω εγώ την προσφορά, είτε μέσω mail είτε στο The Helm
// είτε από το MacBook είτε από την IP του σπιτιού μου, να μην με μετράει."
// His Mac's Chrome was already silent (the gy_staff cookie). What still
// counted was everything without that cookie on his own network: the
// iPhone, the Gmail and WhatsApp in-app browsers (each keeps its own cookie
// jar), Safari, a second Chrome profile.
//
// So the house learns its own addresses. Whenever a request proves it is
// George (a signed-in Command session, the gy_staff cookie, the GY Track
// extension, a ?gs= link from his own copy of an email), the address it came
// from is remembered, and every proposal view, email open and click from
// that address is his. Nothing to configure: when the home address changes,
// the next visit to Command learns the new one.
//
//   desktop  remembered 14 days (home and office broadband)
//   phone    remembered 12 hours (mobile carriers share one address among
//            many subscribers, so it must not linger)
//
// Stored as one small JSON row in settings ("house_ips"); read through a
// 60-second in-memory cache, written only when an entry is new or half
// expired, so an ordinary page load reads at most once a minute and writes
// almost never.

import { getSetting, setSetting } from "@/lib/google-api";

const KEY = "house_ips";
const DESKTOP_TTL_MS = 14 * 86400_000;
const MOBILE_TTL_MS = 12 * 3600_000;
const CACHE_MS = 60_000;
const MAX_ENTRIES = 40;

type Book = Record<string, { until: string; kind: "desktop" | "mobile" }>;
let cache: { at: number; book: Book } | null = null;

export function ipFrom(h: Headers): string | null {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** IPv4 as it is; IPv6 by its /64 (devices rotate the rest for privacy). */
export function ipKey(ip: string): string {
  const s = ip.trim().toLowerCase();
  if (!s.includes(":")) return s;
  const full = s.split("%")[0];
  const [head, tail = ""] = full.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = full.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

async function load(): Promise<Book> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.book;
  let book: Book = {};
  try {
    const raw = await getSetting(KEY);
    if (raw) book = JSON.parse(raw) as Book;
  } catch {
    book = {};
  }
  cache = { at: Date.now(), book };
  return book;
}

export async function isHouseIp(ip: string | null | undefined): Promise<boolean> {
  if (!ip) return false;
  try {
    const e = (await load())[ipKey(ip)];
    return !!e && Date.parse(e.until) > Date.now();
  } catch {
    return false;
  }
}

/** Call only where the request has proved it is George. Never throws. */
export async function noteHouseIp(ip: string | null | undefined, userAgent: string | null | undefined): Promise<void> {
  if (!ip) return;
  try {
    const key = ipKey(ip);
    const mobile = /iPhone|iPad|Android|Mobile/i.test(userAgent || "");
    const ttl = mobile ? MOBILE_TTL_MS : DESKTOP_TTL_MS;
    const now = Date.now();
    const book = await load();
    const prev = book[key];
    const prevUntil = prev ? Date.parse(prev.until) : 0;
    // Fresh enough already: more than half of this kind's life still ahead.
    if (prevUntil - now > ttl / 2) return;
    const next: Book = {};
    for (const [k, v] of Object.entries(book)) if (Date.parse(v.until) > now) next[k] = v;
    next[key] = {
      until: new Date(Math.max(prevUntil, now + ttl)).toISOString(),
      kind: prev?.kind === "desktop" || !mobile ? "desktop" : "mobile",
    };
    const kept = Object.entries(next)
      .sort((a, b) => Date.parse(b[1].until) - Date.parse(a[1].until))
      .slice(0, MAX_ENTRIES);
    const saved = Object.fromEntries(kept) as Book;
    await setSetting(KEY, JSON.stringify(saved));
    cache = { at: now, book: saved };
  } catch (err) {
    console.error("[house-ip] note failed:", err);
  }
}
