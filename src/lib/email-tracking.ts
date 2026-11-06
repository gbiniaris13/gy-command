// src/lib/email-tracking.ts
// 2026-07-23 — Free, self-hosted email open/click tracking.
//
// George's spec: any email leaving his Gmail (The Helm, The Cabin, or a
// Helm-prepared draft he sends himself) reports back BY EMAIL — when it was
// opened, how many times, and what was clicked. No Telegram, no paid tool.
//
// How: every outgoing HTML body gets (a) a 1x1 pixel hitting /api/t/o and
// (b) its links rewritten through /api/t/c which logs and 302-redirects.
// Click URLs carry an HMAC (keyed on CRON_SECRET) so the redirect cannot be
// abused as an open redirect. State lives in the email_tracking table
// (see tracking-migration.sql).
//
// Known honest limitations, stated up front:
//  - Gmail proxies images, so an "open" fires when Gmail loads the pixel —
//    including if George re-reads his own Sent copy. Opens within the first
//    12 seconds of send are ignored to filter the send-time prefetch.
//  - Apple Mail privacy protection preloads pixels, which can inflate opens
//    for recipients on Apple devices. Clicks are always real.

import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";

const GEORGE_EMAIL = "george@georgeyachts.com";

export function trackingBaseUrl(): string {
  // 2026-07-23 George: tracking links ride on our own domain, not
  // vercel.app — vercel.app URLs in emails read as infrastructure and
  // cost spam-score points. command.georgeyachts.com was already
  // attached to this project, so no new domain and no extra build.
  return (
    process.env.TRACKING_BASE_URL ||
    "https://command.georgeyachts.com"
  ).replace(/\/+$/, "");
}

function hmac(input: string): string {
  const key = process.env.CRON_SECRET || "gy-tracking";
  return crypto.createHmac("sha256", key).update(input).digest("base64url").slice(0, 16);
}

export function signClick(token: string, url: string): string {
  return hmac(`${token}|${url}`);
}

function sameSig(a: string, b: string): boolean {
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function verifyClick(token: string, url: string, sig: string): boolean {
  // Links signed here, or signed in George's Gmail by the GY Track extension
  // with its own key (it cannot hold CRON_SECRET, see extKey).
  return sameSig(sig, signClick(token, url)) || sameSig(sig, signClickExt(token, url));
}

// 2026-11-05 — the GY Track Chrome extension. It instruments the emails
// George writes from scratch in Gmail, so it must sign click links in the
// browser, synchronously, at the moment he presses Send. It holds a key
// DERIVED from CRON_SECRET (never the secret itself), fetched once from
// /api/t/ext/key by a signed-in Command tab.
export function extKey(): string {
  const key = process.env.CRON_SECRET || "gy-tracking";
  return crypto.createHmac("sha256", key).update("gy-track-extension").digest("base64url");
}

export function signClickExt(token: string, url: string): string {
  return crypto.createHmac("sha256", extKey()).update(`${token}|${url}`).digest("base64url").slice(0, 16);
}

export function isExtRequest(value: string | null | undefined): boolean {
  return !!value && sameSig(value, extKey());
}

// George's own copy of an Edition link carries ?gs=<this>. The Salon reads
// it, treats the visit as the house and stamps the gy_staff cookie in that
// browser (the Gmail app's in-app browser has no Command session, which is
// how his own reading of a proposal used to count as the client's).
export function staffSig(requestId: string): string {
  return hmac(`staff|${requestId}`);
}

// Internal mail is never tracked: there is nobody to report on.
export function isInternalOnly(recipients: string): boolean {
  const emails = recipients.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]+/g) || [];
  return emails.length > 0 && emails.every((e) => e.endsWith("@georgeyachts.com"));
}

// "That was me" correction link (2026-08-18). Signed with the same key as
// the click redirect so only someone holding a notification can use it.
export function signSelf(token: string, kind: string): string {
  return hmac(`self|${token}|${kind}`);
}

export function selfLink(token: string, kind: "open" | "click"): string {
  return `${trackingBaseUrl()}/api/t/self?t=${encodeURIComponent(token)}&k=${kind}&s=${signSelf(token, kind)}`;
}

// The honest footer under every open/click alert. Gmail proxies images
// identically for a recipient's inbox and for George's own Sent copy, so a
// self-open cannot be detected; it can only be corrected in one click, and
// correcting it re-arms the alert.
export function selfFooter(token: string, kind: "open" | "click"): string[] {
  const noun = kind === "click" ? "click" : "open";
  return [
    ``,
    `Was that you, re-reading your own copy? Correct it here and this ${noun} stops counting.`,
    `The alert re-arms itself, so the client's real first ${noun} still reaches you:`,
    selfLink(token, kind),
  ];
}

export function newToken(): string {
  return crypto.randomBytes(9).toString("base64url");
}

// Register the outgoing email and return its token. Never throws — tracking
// must never block a send.
export async function registerTrackedEmail(args: {
  source: string;
  recipient: string;
  subject: string;
}): Promise<string | null> {
  try {
    if (isInternalOnly(args.recipient)) return null;
    const token = newToken();
    const sb = createServiceClient();
    const { error } = await sb.from("email_tracking").insert({
      token,
      source: args.source,
      recipient: args.recipient.slice(0, 300),
      subject: args.subject.slice(0, 500),
    });
    if (error) {
      console.error("[tracking] register failed:", error.message);
      return null;
    }
    return token;
  } catch (err) {
    console.error("[tracking] register threw:", err);
    return null;
  }
}

// Instrument an HTML body: rewrite <a href> links through the click
// endpoint, linkify bare https URLs the same way, append the open pixel.
export function instrumentHtml(html: string, token: string): string {
  const base = trackingBaseUrl();

  const clickUrl = (url: string): string => {
    const u = Buffer.from(url).toString("base64url");
    return `${base}/api/t/c?t=${token}&u=${u}&s=${signClick(token, url)}`;
  };

  let out = html.replace(
    /(<a\b[^>]*\bhref=")(https?:\/\/[^"]+)(")/gi,
    (_m, pre, url, post) => `${pre}${clickUrl(url)}${post}`,
  );

  // Bare URLs in <br>-converted plain-text bodies: wrap them so clicks count.
  // Skip anything already inside an attribute (preceded by " or ').
  out = out.replace(
    /(^|[^"'>])(https?:\/\/[^\s<"']+)/g,
    (_m, pre, url) => `${pre}<a href="${clickUrl(url)}">${url}</a>`,
  );

  const pixel = `<img src="${base}/api/t/o?t=${token}" width="1" height="1" alt="" style="display:none">`;
  return `${out}${pixel}`;
}

// Delivery-time noise window. Gmail's image proxy PREFETCHES images the
// moment a message lands in a Gmail inbox (and link scanners probe URLs on
// arrival), which fired a false "opened 0 minutes ago" on George's first
// real Helm send (2026-07-24, Mr. Dahan). Hits inside this window after
// send are machines, not humans - ignored for opens AND clicks.
export const DELIVERY_GRACE_MS = 120_000;

// 2026-11-06: the two-minute window was swallowing real readers. George
// sent himself a test, opened it 31 seconds later and tapped the link at 38
// seconds, on his iPhone, and heard nothing: both were filed as "prefetch".
// What actually fetches in the first moments after a send is narrower:
//   - scanners at the recipient's gateway, within seconds of delivery;
//   - George's own Gmail showing him his own copy, through Google's proxy,
//     until that copy has been swapped for the one without a tracker.
// So: everything in the first 20 seconds is a machine (15 for clicks);
// after that a Gmail-proxy open is only doubted while George's own copy
// still carries the pixel (see ownCopyGone); anything else is a reader.
export const SCANNER_WINDOW_MS = 20_000;
export const CLICK_SCANNER_WINDOW_MS = 15_000;

// ── Hit classification, v2 (2026-07-24) ─────────────────────────────────
// George: "don't stop at the 2-minute window - see what HubSpot does and
// beat it". HubSpot layers a known-bot list over custom rules; GMass and
// Postmark add User-Agent + timing signatures. We do all three, per hit:
//
//   prefetch   inside DELIVERY_GRACE_MS of send (Gmail/Apple load-on-
//              delivery, link scanners probing on arrival)
//   bot        security-scanner / script User-Agent, an EMPTY User-Agent,
//              or a click BURST (two different links inside 8s - scanners
//              walk every link at machine speed; humans do not)
//   apple-mpp  Apple Mail Privacy Protection: Apple's proxy preloads every
//              image and serves later opens from its own cache, so the
//              true open state of an Apple-proxied recipient is unknowable
//              by design. Counted apart, never notified as a human open.
//   human      everything else - including Gmail's GoogleImageProxy AFTER
//              the grace window, which is how a real Gmail display fetches.
//
// Only `human` updates counts and triggers notifications.
export type HitVerdict = "human" | "prefetch" | "bot" | "apple-mpp" | "self" | "draft";

const BOT_UA = new RegExp(
  [
    "barracuda", "proofpoint", "mimecast", "symantec", "messagelabs",
    "trendmicro", "forcepoint", "sophos", "fireeye", "paloalto",
    "python-requests", "python/", "\\bcurl\\b", "\\bwget\\b",
    "go-http-client", "\\bjava/", "okhttp", "libwww", "httpclient",
    "headlesschrome", "phantomjs", "\\bbot\\b", "spider", "crawler",
    "urlscan", "scanner", "validator", "monitoring", "preview\\b",
  ].join("|"),
  "i",
);

// Apple's MPP proxy identifies itself with a bare "Mozilla/5.0" and
// nothing else (documented by Postmark/Bloomreach).
function isAppleMpp(ua: string): boolean {
  return ua.trim() === "Mozilla/5.0";
}

export function classifyOpen(args: {
  userAgent: string | null;
  sentAtMs: number | null;
  nowMs: number;
}): HitVerdict {
  const ua = (args.userAgent || "").trim();
  const age =
    args.sentAtMs != null && Number.isFinite(args.sentAtMs) ? args.nowMs - args.sentAtMs : Infinity;
  if (age < SCANNER_WINDOW_MS) return "prefetch";
  if (!ua) return "bot";
  if (BOT_UA.test(ua)) return "bot";
  if (isAppleMpp(ua)) return "apple-mpp";
  // Provisional: the pixel route lifts this to "human" when George's own
  // copy is already clean, so the fetch cannot be his.
  if (age < DELIVERY_GRACE_MS && viaGoogleProxy(ua)) return "prefetch";
  return "human";
}

export function classifyClick(args: {
  userAgent: string | null;
  sentAtMs: number | null;
  nowMs: number;
  // The most recent PRIOR click hit for this token, any verdict.
  prevClick: { atMs: number; url: string | null } | null;
  url: string;
}): HitVerdict {
  const ua = (args.userAgent || "").trim();
  if (
    args.sentAtMs != null &&
    Number.isFinite(args.sentAtMs) &&
    args.nowMs - args.sentAtMs < CLICK_SCANNER_WINDOW_MS
  ) {
    return "prefetch";
  }
  if (!ua) return "bot";
  if (BOT_UA.test(ua)) return "bot";
  // Burst rule: a second DIFFERENT link inside 8 seconds is a scanner
  // walking the link list, not a reader. The click route also looks the
  // other way (a different link shortly AFTER this one) before it counts.
  if (
    args.prevClick &&
    args.nowMs - args.prevClick.atMs < BURST_MS &&
    args.prevClick.url !== args.url
  ) {
    return "bot";
  }
  return "human";
}

export const BURST_MS = 8_000;

// Is George's own copy of this email already the one without a tracker,
// and was it so before `atMs`? Then a Gmail-proxy fetch at `atMs` cannot be
// his Sent copy; it is the recipient's Gmail.
export async function ownCopyGone(token: string, atMs: number): Promise<boolean> {
  const c = await readMeta(token, "copy");
  return !!c && c.verdict === "done" && Date.parse(c.at) <= atMs;
}

// RFC 2047 encoding for header values. Raw UTF-8 (emoji included) in a
// Subject header is mojibake roulette - George's first notification
// rendered as "Ã°ÂŸÂ“Â¬". Base64 word-encoding is what Gmail itself emits.
export function encodeHeaderWord(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

// Minimal raw email builder for the notification reports back to George.
function rawEmail(subject: string, body: string): string {
  const lines = [
    `From: GY Command <${GEORGE_EMAIL}>`,
    `To: ${GEORGE_EMAIL}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function emailGeorgeReport(subject: string, body: string): Promise<boolean> {
  try {
    const res = await gmailFetch("/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: rawEmail(subject, body) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function athensTime(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/Athens",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── v3 (2026-11-05): every open, every click, one thread per email ──────
// George: "θέλω να ξέρω πότε το ανοίγει, τι link πάτησε, πότε το ξανάνοιξε,
// θέλω να τα ξέρω όλα". v2 told him about the FIRST open and the FIRST click
// and counted the rest in silence. v3 reports every reading session and
// every click, and files all reports about one email in ONE Gmail thread,
// so his inbox shows one line per email that moves up when it moves.
//
// Bookkeeping rides in email_tracking_hits under kinds that are not "open"
// or "click" (msg, copy, alert, seen, replied), so no schema change on the
// live database and nothing that reads hits by kind sees them.

export type MetaKind = "msg" | "copy" | "alert" | "seen" | "replied";

export async function recordMeta(token: string, kind: MetaKind, verdict: string, data: Record<string, unknown> = {}): Promise<void> {
  try {
    const sb = createServiceClient();
    await sb.from("email_tracking_hits").insert({ token, kind, verdict, url: JSON.stringify(data).slice(0, 800) });
  } catch (err) {
    console.error("[tracking] meta failed:", err);
  }
}

export async function readMeta(token: string, kind: MetaKind): Promise<{ verdict: string; at: string; data: Record<string, string> } | null> {
  try {
    const sb = createServiceClient();
    const { data } = await sb
      .from("email_tracking_hits")
      .select("verdict, at, url")
      .eq("token", token)
      .eq("kind", kind)
      .order("at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    let parsed: Record<string, string> = {};
    try { parsed = JSON.parse(data.url || "{}"); } catch { /* keep empty */ }
    return { verdict: data.verdict, at: data.at, data: parsed };
  } catch {
    return null;
  }
}

/** Remember which Gmail message carries this token (Helm and Cabin sends). */
export async function noteSentMessage(token: string | null, messageId: string, threadId?: string): Promise<void> {
  if (!token || !messageId) return;
  await recordMeta(token, "msg", "meta", { m: messageId, th: threadId || "" });
}

// Where a reader was. Gmail and Yahoo fetch images through their own
// proxies, so for an open the place is the proxy's, never the reader's:
// we say "Gmail" and stop. A click is the reader's own browser, so city
// and device are theirs.
export function deviceFromUa(ua: string | null): string {
  const u = ua || "";
  if (/GoogleImageProxy|ggpht\.com/i.test(u)) return "Gmail";
  if (/YahooMailProxy/i.test(u)) return "Yahoo Mail";
  if (/Outlook|ms-office|MSOffice/i.test(u)) return "Outlook";
  if (/iPhone/i.test(u)) return "iPhone";
  if (/iPad/i.test(u)) return "iPad";
  if (/Android/i.test(u)) return "Android";
  if (/Macintosh|Mac OS X/i.test(u)) return "Mac";
  if (/Windows/i.test(u)) return "Windows";
  return "";
}

export function placeFromHeaders(h: Headers): string {
  const dec = (v: string | null) => {
    try { return v ? decodeURIComponent(v) : ""; } catch { return v || ""; }
  };
  const city = dec(h.get("x-vercel-ip-city"));
  const region = dec(h.get("x-vercel-ip-country-region"));
  const country = dec(h.get("x-vercel-ip-country"));
  return [city, region && region !== city ? region : "", country].filter(Boolean).join(", ");
}

/** "1.2.3.4 | Miami, FL, US" — the place rides in the ip column. */
export function ipWithPlace(ip: string | null, place: string): string | null {
  if (!place) return ip;
  return `${ip || ""} | ${place}`.slice(0, 200);
}

function placeOf(ipField: string | null): string {
  const i = (ipField || "").indexOf(" | ");
  return i >= 0 ? (ipField || "").slice(i + 3) : "";
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (k.startsWith("utm_")) x.searchParams.delete(k);
    return `${x.host}${x.pathname === "/" ? "" : x.pathname}${x.search}`.slice(0, 90);
  } catch {
    return u.slice(0, 90);
  }
}

type HitRow = { kind: string; at: string; verdict: string; user_agent: string | null; ip: string | null; url: string | null };

export async function timelineFor(token: string, sentAt: string): Promise<{ lines: string[]; humanOpens: number; humanClicks: number; apple: number }> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("email_tracking_hits")
    .select("kind, at, verdict, user_agent, ip, url")
    .eq("token", token)
    .in("kind", ["open", "click"])
    .order("at", { ascending: true })
    .limit(300);
  const hits = (data || []) as HitRow[];
  const lines = [`  ${athensTime(sentAt)}   sent`];
  let opens = 0, clicks = 0, apple = 0;
  for (const h of hits) {
    if (h.verdict === "apple-mpp") { apple++; continue; }
    if (h.verdict !== "human") continue;
    const dev = deviceFromUa(h.user_agent);
    const place = placeOf(h.ip);
    if (h.kind === "open") {
      opens++;
      lines.push(`  ${athensTime(h.at)}   opened${opens > 1 ? ` (${ordinal(opens)} time)` : ""}${dev ? ` · ${dev}` : ""}`);
    } else {
      clicks++;
      const where = [dev, place].filter(Boolean).join(", ");
      lines.push(`  ${athensTime(h.at)}   clicked ${shortUrl(h.url || "")}${where ? ` · ${where}` : ""}`);
    }
  }
  return { lines, humanOpens: opens, humanClicks: clicks, apple };
}

// Do we have proof this email actually left? A Helm draft is registered
// the moment it is written, and Helm leaves follow-up drafts inside the
// client's conversation: every time George opened that conversation the
// draft's pixel fired and he was told the client had "opened again"
// (2026-11-05, the Patti thread, twice). A draft's opens only count once
// the message has been found in Sent (a `copy` or `msg` record naming it).
export async function knownSent(token: string): Promise<boolean> {
  try {
    const sb = createServiceClient();
    const { data } = await sb
      .from("email_tracking_hits")
      .select("url")
      .eq("token", token)
      .in("kind", ["copy", "msg"])
      .limit(20);
    return (data || []).some((d) => /"(o|m)":"[^"]+"/.test(d.url || ""));
  } catch {
    return false;
  }
}

export function viaGoogleProxy(ua: string | null): boolean {
  return /GoogleImageProxy|ggpht\.com/i.test(ua || "");
}

// Has the recipient answered in this thread since the email went out?
// Their reply quotes George's email, pixel included, so once they have
// answered, an open that arrives through Gmail's image proxy is very often
// George reading that reply, and it stays silent. An open from the
// recipient's own mail program (a real browser or Outlook signature) is
// theirs for certain and still alerts. Clicks always alert.
export async function hasReplied(token: string, sentAt: string): Promise<boolean> {
  const known = await readMeta(token, "replied");
  if (known) return true;
  const copy = await readMeta(token, "copy");
  const msg = copy?.data?.th ? copy : await readMeta(token, "msg");
  const threadId = msg?.data?.th;
  if (!threadId) return false;
  try {
    const res = await gmailFetch(`/threads/${threadId}?format=metadata&metadataHeaders=From`);
    if (!res.ok) return false;
    const t = (await res.json()) as { messages?: { labelIds?: string[]; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } }[] };
    const sentMs = Date.parse(sentAt);
    const replied = (t.messages || []).some((m) => {
      const labels = m.labelIds || [];
      if (labels.includes("SENT") || labels.includes("DRAFT")) return false;
      const from = (m.payload?.headers || []).find((h) => h.name.toLowerCase() === "from")?.value || "";
      if (/@georgeyachts\.com/i.test(from)) return false;
      return Number(m.internalDate || 0) > sentMs;
    });
    if (replied) await recordMeta(token, "replied", "meta", {});
    return replied;
  } catch {
    return false;
  }
}

// One Gmail thread per tracked email. The first alert sets a Message-ID we
// own; every later one replies to it with the same subject and threadId.
export async function sendThreadedAlert(token: string, subject: string, body: string): Promise<boolean> {
  try {
    const prior = await readMeta(token, "alert");
    const rootId = `<gy-track-${token}@georgeyachts.com>`;
    const headers = [
      `From: GY Command <${GEORGE_EMAIL}>`,
      `To: ${GEORGE_EMAIL}`,
      `Subject: ${encodeHeaderWord(subject)}`,
      prior ? `In-Reply-To: ${rootId}` : `Message-ID: ${rootId}`,
      ...(prior ? [`References: ${rootId}`] : []),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      body,
    ];
    const payload: Record<string, string> = { raw: Buffer.from(headers.join("\r\n")).toString("base64url") };
    if (prior?.data?.th) payload.threadId = prior.data.th;
    const res = await gmailFetch("/messages/send", { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok) return false;
    const sent = (await res.json()) as { threadId?: string };
    if (!prior && sent.threadId) await recordMeta(token, "alert", "meta", { th: sent.threadId });
    return true;
  } catch {
    return false;
  }
}

export function alertSubject(row: { recipient: string | null; subject: string | null }): string {
  return `\u{1F4EC} ${(row.recipient || "unknown").slice(0, 60)} · ${(row.subject || "(no subject)").slice(0, 70)}`;
}

// A "seen" mark is George's own Gmail (the GY Track extension) reporting
// that an email carrying this token is on his screen right now. Opens that
// land around it are his, not the client's.
export const SEEN_WINDOW_MS = 120_000;

export async function seenRecently(token: string, nowMs: number): Promise<boolean> {
  const seen = await readMeta(token, "seen");
  return !!seen && nowMs - Date.parse(seen.at) < SEEN_WINDOW_MS;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
