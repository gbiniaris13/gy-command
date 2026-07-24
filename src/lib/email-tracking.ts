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

// Minimal raw email builder for the notification reports back to George.
function rawEmail(subject: string, body: string): string {
  const lines = [
    `From: GY Command <${GEORGE_EMAIL}>`,
    `To: ${GEORGE_EMAIL}`,
    `Subject: ${subject}`,
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
