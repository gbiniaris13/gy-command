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

export function verifyClick(token: string, url: string, sig: string): boolean {
  const expected = signClick(token, url);
  return (
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
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
export type HitVerdict = "human" | "prefetch" | "bot" | "apple-mpp";

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
  if (
    args.sentAtMs != null &&
    Number.isFinite(args.sentAtMs) &&
    args.nowMs - args.sentAtMs < DELIVERY_GRACE_MS
  ) {
    return "prefetch";
  }
  if (!ua) return "bot";
  if (BOT_UA.test(ua)) return "bot";
  if (isAppleMpp(ua)) return "apple-mpp";
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
    args.nowMs - args.sentAtMs < DELIVERY_GRACE_MS
  ) {
    return "prefetch";
  }
  if (!ua) return "bot";
  if (BOT_UA.test(ua)) return "bot";
  // Burst rule: a second DIFFERENT link inside 8 seconds is a scanner
  // walking the link list, not a reader.
  if (
    args.prevClick &&
    args.nowMs - args.prevClick.atMs < 8_000 &&
    args.prevClick.url !== args.url
  ) {
    return "bot";
  }
  return "human";
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
