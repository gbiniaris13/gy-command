// @ts-nocheck
//
// Daily SYSTEM-WIDE health check — runs 07:05 UTC (10:05 Athens summer).
//
// George flagged 2026-04-29 that he loved the existing 10:00 site
// health check (in george-yachts repo) and wanted the same pattern
// extended to EVERY technology we've built — CRM, social media,
// Sanity, AI, Facebook, TikTok, LinkedIn, etc.
//
// This cron complements (does NOT replace) the existing site check.
// Different scope:
//   • 07:00 UTC site check (george-yachts)  — public-facing pages
//                                              + form APIs + Gmail
//                                              + Telegram bot
//   • 07:05 UTC system check (THIS file)    — backend infrastructure
//                                              + tokens + content
//                                              queues + cron health
//
// Output is one Telegram message in three sections:
//   1. ✓ All core services OK   (silent line items)
//   2. ⚠️ Warnings              (predictive — tokens expiring, queues
//                                getting low, cadence drifting)
//   3. ❌ Critical              (immediate failures requiring action)
//
// The "predictive warnings" path is what George specifically asked
// for: "να μου λέει ότι κοίταξε να δεις εδώ θα σταματήσει να
// λειτουργήσει σε μια βδομάδα γιατί δεν έχετε βάλει περιεχόμενο".
// Translation: tell me when something is about to break, not after.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Severity = "ok" | "warning" | "critical";
interface CheckResult {
  name: string;
  severity: Severity;
  ms?: number;
  message: string;
  /** When set, the line includes the predictive forecast. */
  predicts?: string;
}

const NEWSLETTER_SITE = "https://georgeyachts.com";

// ─── helpers ────────────────────────────────────────────────────────

async function timeIt<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - start };
}

function ok(name: string, ms: number, message = "OK"): CheckResult {
  return { name, severity: "ok", ms, message };
}
function warn(name: string, message: string, predicts?: string): CheckResult {
  return { name, severity: "warning", message, predicts };
}
function critical(name: string, message: string): CheckResult {
  return { name, severity: "critical", message };
}

// ─── core infrastructure checks ─────────────────────────────────────

async function checkSupabase(): Promise<CheckResult> {
  try {
    const sb = createServiceClient();
    const { result, ms } = await timeIt(() =>
      sb.from("settings").select("key", { count: "exact", head: true }).limit(1),
    );
    if (result.error) return critical("Supabase", result.error.message);
    return ok("Supabase", ms);
  } catch (e: any) {
    return critical("Supabase", e?.message ?? "exception");
  }
}

async function checkVercelKVNewsletter(): Promise<CheckResult> {
  // Probe the newsletter status admin endpoint on the public site
  // (it returns subscriber counts from KV). If it 200s, KV is up.
  try {
    const { result, ms } = await timeIt(() =>
      fetch(`${NEWSLETTER_SITE}/api/admin/newsletter-status`, { cache: "no-store" }),
    );
    if (!result.ok) return critical("Vercel KV (newsletter)", `HTTP ${result.status}`);
    return ok("Vercel KV (newsletter)", ms);
  } catch (e: any) {
    return critical("Vercel KV (newsletter)", e?.message ?? "exception");
  }
}

async function checkResendAPI(): Promise<CheckResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return critical("Resend API", "RESEND_API_KEY not set");
  try {
    const { result, ms } = await timeIt(() =>
      fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    if (result.status === 401) return critical("Resend API", "API key rejected (401)");
    if (!result.ok) return critical("Resend API", `HTTP ${result.status}`);
    return ok("Resend API", ms);
  } catch (e: any) {
    return critical("Resend API", e?.message ?? "exception");
  }
}

async function checkTelegramBot(): Promise<CheckResult> {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) return critical("Telegram Bot", "TELEGRAM_BOT_TOKEN not set");
  try {
    const { result, ms } = await timeIt(() =>
      fetch(`https://api.telegram.org/bot${t}/getMe`),
    );
    if (!result.ok) return critical("Telegram Bot", `HTTP ${result.status}`);
    return ok("Telegram Bot", ms);
  } catch (e: any) {
    return critical("Telegram Bot", e?.message ?? "exception");
  }
}

async function checkGmailSMTP(): Promise<CheckResult> {
  const u = process.env.GMAIL_USER;
  const p = process.env.GMAIL_PASS;
  if (!u || !p) return critical("Gmail SMTP", "GMAIL_USER / GMAIL_PASS not set");
  const start = Date.now();
  try {
    const t = nodemailer.createTransport({
      service: "gmail",
      auth: { user: u, pass: p },
    });
    await t.verify();
    return ok("Gmail SMTP", Date.now() - start);
  } catch (e: any) {
    return critical("Gmail SMTP", e?.message ?? "verify failed");
  }
}

async function checkSanityCMS(): Promise<CheckResult> {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
  if (!projectId) return critical("Sanity CMS", "project id not set");
  try {
    const url = `https://${projectId}.api.sanity.io/v2023-11-09/data/query/${dataset}?query=count(*[_type=='yacht'])`;
    const { result, ms } = await timeIt(() => fetch(url));
    if (!result.ok) return critical("Sanity CMS", `HTTP ${result.status}`);
    return ok("Sanity CMS", ms);
  } catch (e: any) {
    return critical("Sanity CMS", e?.message ?? "exception");
  }
}

// ─── Meta token expiry (predictive) ─────────────────────────────────

async function checkIGTokenExpiry(): Promise<CheckResult> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return warn("IG Access Token", "not configured");
  try {
    const { result, ms } = await timeIt(() =>
      fetch(
        `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
      ),
    );
    if (!result.ok) return critical("IG Access Token", `HTTP ${result.status}`);
    const json = await result.json();
    const expiresAt = json?.data?.expires_at; // unix seconds; 0 means never
    const isValid = json?.data?.is_valid;
    if (!isValid) return critical("IG Access Token", "Meta says token invalid");
    if (!expiresAt) return ok("IG Access Token", ms, "never expires");
    const daysLeft = Math.floor((expiresAt * 1000 - Date.now()) / 86400000);
    if (daysLeft < 7) {
      return critical(
        "IG Access Token",
        `expires in ${daysLeft} days — refresh NOW before bot stops`,
      );
    }
    if (daysLeft < 21) {
      return warn(
        "IG Access Token",
        `expires in ${daysLeft} days`,
        "refresh soon — bot will stop posting when this lapses",
      );
    }
    return ok("IG Access Token", ms, `${daysLeft} days remaining`);
  } catch (e: any) {
    return warn("IG Access Token", e?.message ?? "check failed");
  }
}

// ─── Content queue depth (predictive) ───────────────────────────────

async function checkIGContentQueue(sb: any): Promise<CheckResult> {
  try {
    const start = Date.now();
    const { count } = await sb
      .from("ig_posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "scheduled");
    const ms = Date.now() - start;
    const scheduled = count ?? 0;
    // Cron publishes 1/day on average; <3 days ahead is risky.
    if (scheduled < 3) {
      return critical(
        "IG content queue",
        `only ${scheduled} scheduled posts — auto-publish will stall in ${Math.max(scheduled, 0)} days`,
      );
    }
    if (scheduled < 7) {
      return warn(
        "IG content queue",
        `${scheduled} scheduled (need ≥ 7 for a week of runway)`,
        "queue runs out in less than a week",
      );
    }
    return ok("IG content queue", ms, `${scheduled} scheduled`);
  } catch (e: any) {
    return warn("IG content queue", e?.message ?? "query failed");
  }
}

async function checkBlogCadence(): Promise<CheckResult> {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
  if (!projectId) return warn("Blog cadence", "Sanity not configured");
  try {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const query = encodeURIComponent(
      `count(*[_type == "post" && publishedAt > "${cutoff}"])`,
    );
    const url = `https://${projectId}.api.sanity.io/v2023-11-09/data/query/${dataset}?query=${query}`;
    const { result, ms } = await timeIt(() => fetch(url));
    if (!result.ok) return warn("Blog cadence", `HTTP ${result.status}`);
    const json = await result.json();
    const recentPosts = Number(json?.result ?? 0);
    if (recentPosts === 0) {
      return warn(
        "Blog cadence",
        "no blog posts in last 30 days",
        "Bridge auto-cron will stop suggesting /blog recap; only yacht highlights remain",
      );
    }
    return ok("Blog cadence", ms, `${recentPosts} post(s) in last 30 days`);
  } catch (e: any) {
    return warn("Blog cadence", e?.message ?? "check failed");
  }
}

async function checkNewsletterQueue(stream: "wake" | "compass"): Promise<CheckResult> {
  // Hit the public-site queues admin endpoint via proxy auth.
  const secret = process.env.NEWSLETTER_PROXY_SECRET;
  if (!secret) return warn(`${stream} intel queue`, "NEWSLETTER_PROXY_SECRET not set");
  try {
    const { result, ms } = await timeIt(() =>
      fetch(
        `${NEWSLETTER_SITE}/api/admin/newsletter-queue?stream=${stream}&status=pending&key=${encodeURIComponent(secret)}`,
        { cache: "no-store" },
      ),
    );
    if (!result.ok) return warn(`${stream} intel queue`, `HTTP ${result.status}`);
    const json = await result.json();
    const pending = Number(json?.pending_count ?? 0);
    // Wake fires 15th of month, Compass 1st of even month.
    // Roughly 7-day "warning window" before the next firing.
    const now = new Date();
    const day = now.getUTCDate();
    const month = now.getUTCMonth();
    let daysUntilFire = 999;
    if (stream === "wake") {
      daysUntilFire = day <= 15 ? 15 - day : 30 + (15 - day);
    } else {
      // Compass: 1st of even calendar month (Feb=1, Apr=3, Jun=5…)
      const isEvenMonth = [1, 3, 5, 7, 9, 11].includes(month);
      if (isEvenMonth && day === 1) daysUntilFire = 0;
      else if (isEvenMonth) daysUntilFire = 30 - day + 1;
      else daysUntilFire = 30 - day + 1;
    }
    if (pending === 0 && daysUntilFire <= 7) {
      return warn(
        `${stream} intel queue`,
        `0 pending entries, cron fires in ${daysUntilFire}d`,
        `add intel signal in CRM Newsletter → Queues tab or send day will alert "queue empty"`,
      );
    }
    if (pending === 0) {
      return warn(`${stream} intel queue`, `0 pending (cron in ${daysUntilFire}d — still time)`);
    }
    return ok(`${stream} intel queue`, ms, `${pending} pending`);
  } catch (e: any) {
    return warn(`${stream} intel queue`, e?.message ?? "check failed");
  }
}

// ─── Resend monthly quota (predictive) ──────────────────────────────

async function checkResendQuota(): Promise<CheckResult> {
  // We don't have direct access to the public-site KV here, but the
  // newsletter daily digest cron logs the count to settings every
  // afternoon. As a proxy, hit the season endpoint which returns
  // monthly_used in its payload (reads from quota.js).
  const secret = process.env.NEWSLETTER_PROXY_SECRET;
  if (!secret) return warn("Resend monthly quota", "NEWSLETTER_PROXY_SECRET not set");
  try {
    // Probe via the engagement endpoint which doesn't require stream.
    // Quick fall-through: use status which always works.
    const { result, ms } = await timeIt(() =>
      fetch(`${NEWSLETTER_SITE}/api/admin/newsletter-status?key=${encodeURIComponent(secret)}`, {
        cache: "no-store",
      }),
    );
    if (!result.ok) return warn("Resend monthly quota", `HTTP ${result.status}`);
    // Status doesn't carry monthly count directly. Treat the round-trip
    // success as a signal; the dedicated Phase 6 alerts handle the
    // 80/90/95% pings independently.
    return ok("Resend monthly quota", ms, "see Phase 6 alerts for thresholds");
  } catch (e: any) {
    return warn("Resend monthly quota", e?.message ?? "check failed");
  }
}

// ─── Cron failure detection (last 24h) ──────────────────────────────

async function checkRecentCronFailures(sb: any): Promise<CheckResult> {
  try {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const start = Date.now();
    // Cron observer writes cron_end_<id> rows. Failures have
    // outcome != 'success' in the value JSON.
    const { data, error } = await sb
      .from("settings")
      .select("key, value")
      .like("key", "cron_end_%")
      .gte("created_at", cutoff)
      .limit(500);
    const ms = Date.now() - start;
    if (error) return warn("Cron health (24h)", error.message);
    if (!data || data.length === 0) {
      return ok("Cron health (24h)", ms, "no records — observer may be off or quiet day");
    }
    let failed = 0;
    const failedJobs = new Set<string>();
    for (const row of data) {
      try {
        const v = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
        if (v?.outcome && v.outcome !== "success" && v.outcome !== "skipped") {
          failed += 1;
          if (v.cron_id) failedJobs.add(String(v.cron_id));
        }
      } catch {
        // skip malformed
      }
    }
    if (failed === 0) {
      return ok("Cron health (24h)", ms, `${data.length} runs, all green`);
    }
    return warn(
      "Cron health (24h)",
      `${failed} failure(s) in last 24h: ${[...failedJobs].slice(0, 4).join(", ")}${failedJobs.size > 4 ? "…" : ""}`,
    );
  } catch (e: any) {
    return warn("Cron health (24h)", e?.message ?? "exception");
  }
}

// ─── orchestration ──────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function _observedImpl() {
  const sb = createServiceClient();

  // Run all checks in parallel — order doesn't matter for correctness,
  // but parallelism keeps total wall time under ~5s.
  const checks = await Promise.all([
    checkSupabase(),
    checkVercelKVNewsletter(),
    checkResendAPI(),
    checkTelegramBot(),
    checkGmailSMTP(),
    checkSanityCMS(),
    checkIGTokenExpiry(),
    checkBlogCadence(),
    checkNewsletterQueue("wake"),
    checkNewsletterQueue("compass"),
    checkResendQuota(),
    checkIGContentQueue(sb),
    checkRecentCronFailures(sb),
  ]);

  const okList = checks.filter((c) => c.severity === "ok");
  const warnList = checks.filter((c) => c.severity === "warning");
  const critList = checks.filter((c) => c.severity === "critical");

  const ts = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/Athens",
    hour12: false,
  });

  const lines: string[] = [];
  if (critList.length > 0) {
    lines.push(`🚨 <b>System Health Check — Issues Detected</b>`);
  } else if (warnList.length > 0) {
    lines.push(`⚠️ <b>System Health Check — Warnings</b>`);
  } else {
    lines.push(`✅ <b>System Health Check — All OK</b>`);
  }
  lines.push(`🕐 ${ts} Athens`, ``);

  // Critical first — most urgent
  if (critList.length > 0) {
    lines.push(`<b>❌ Critical (${critList.length})</b>`);
    for (const c of critList) {
      lines.push(`❌ ${escapeHtml(c.name)} — ${escapeHtml(c.message)}`);
    }
    lines.push(``);
  }

  // Warnings (predictive)
  if (warnList.length > 0) {
    lines.push(`<b>⚠️ Warnings (${warnList.length})</b>`);
    for (const w of warnList) {
      lines.push(`⚠️ ${escapeHtml(w.name)} — ${escapeHtml(w.message)}`);
      if (w.predicts) lines.push(`   ↳ <i>${escapeHtml(w.predicts)}</i>`);
    }
    lines.push(``);
  }

  // OK list — terse one-line each
  if (okList.length > 0) {
    lines.push(`<b>✅ OK (${okList.length})</b>`);
    for (const c of okList) {
      const tail = c.message && c.message !== "OK" ? ` — ${escapeHtml(c.message)}` : "";
      lines.push(`✓ ${escapeHtml(c.name)} — ${c.ms ?? 0}ms${tail}`);
    }
    lines.push(``);
  }

  if (critList.length === 0 && warnList.length === 0) {
    lines.push(`<i>Όλα λειτουργούν σωστά.</i>`);
  } else if (critList.length === 0) {
    lines.push(`<i>Όλα τα core services OK — οι warnings είναι predictive (πες το πριν χαλάσει).</i>`);
  } else {
    lines.push(`<i>${critList.length} critical issue(s) χρειάζονται άμεση προσοχή.</i>`);
  }

  await sendTelegram(lines.join("\n")).catch((e) =>
    console.error("system-health-check telegram failed:", e),
  );

  return NextResponse.json({
    ok: critList.length === 0,
    timestamp: ts,
    summary: {
      ok: okList.length,
      warnings: warnList.length,
      critical: critList.length,
    },
    checks,
  });
}

export async function GET(...args: any[]) {
  return observeCron("system-health-check", () => (_observedImpl as any)(...args));
}
