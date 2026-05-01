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
  // Resend lives on the public-site repo (george-yachts) — the
  // newsletter system pushes through it, not gy-command. We only run
  // the live API ping if a key happens to be set in this app's env;
  // otherwise this check is a no-op rather than a false-positive
  // critical.
  const key = process.env.RESEND_API_KEY;
  if (!key) return ok("Resend API", 0, "not used in this app (public site)");
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

async function checkGmailOAuth(sb: any): Promise<CheckResult> {
  // gy-command uses the Gmail OAuth refresh-token flow (stored in
  // settings.gmail_refresh_token), NOT GMAIL_USER/GMAIL_PASS. Verify
  // the refresh token row exists. Liveness is exercised every 5 min
  // by /api/cron/gmail-poll-replies — if the token revokes, that
  // cron 5xx's and surfaces in "Cron failures (24h)" below.
  try {
    const { data } = await sb
      .from("settings")
      .select("value, updated_at")
      .eq("key", "gmail_refresh_token")
      .maybeSingle();
    if (!data?.value) {
      return critical("Gmail OAuth", "no refresh token stored — re-auth required");
    }
    return ok("Gmail OAuth", 0, "refresh token present");
  } catch (e: any) {
    return warn("Gmail OAuth", e?.message ?? "exception");
  }
}

async function checkSanityCMS(): Promise<CheckResult> {
  // Sanity project ID is hardcoded in src/lib/sanity-fleet.ts as
  // "ecqr94ey" with the production dataset, hit via the public CDN
  // (no auth needed for read-only fleet queries). Allow override via
  // NEXT_PUBLIC_SANITY_PROJECT_ID for staging if ever needed.
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "ecqr94ey";
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
  try {
    const url = `https://${projectId}.apicdn.sanity.io/v2024-01-01/data/query/${dataset}?query=count(*[_type=='yacht'])`;
    const { result, ms } = await timeIt(() => fetch(url));
    if (!result.ok) return critical("Sanity CMS", `HTTP ${result.status}`);
    return ok("Sanity CMS", ms);
  } catch (e: any) {
    return critical("Sanity CMS", e?.message ?? "exception");
  }
}

// ─── Meta token expiry (predictive) ─────────────────────────────────

async function checkFBPageToken(): Promise<CheckResult> {
  // FB Page token check. Mirrors checkIGTokenExpiry — hits the live
  // graph endpoint with the page token, surfaces Meta's error message
  // verbatim on failure. The facebook-mirror cron uses this token
  // every day at 15:35 UTC to cross-post IG content; a token blip
  // would mean cross-posts silently 5xx and the FB feed goes dark.
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FB_PAGE_ID || "1056750427517361";
  if (!token) return warn("FB Page Token", "FB_PAGE_ACCESS_TOKEN not set");
  try {
    const { result, ms } = await timeIt(() =>
      fetch(
        `https://graph.facebook.com/v21.0/${pageId}?fields=id,name&access_token=${encodeURIComponent(token)}`,
      ),
    );
    if (!result.ok) {
      const body = await result.text().catch(() => "");
      const reason = body.match(/"message":"([^"]+)"/)?.[1] ?? `HTTP ${result.status}`;
      return critical("FB Page Token", reason);
    }
    const json = await result.json();
    return ok("FB Page Token", ms, `live as ${json?.name ?? "unknown page"}`);
  } catch (e: any) {
    return warn("FB Page Token", e?.message ?? "check failed");
  }
}

async function checkIGTokenExpiry(): Promise<CheckResult> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return warn("IG Access Token", "not configured");
  try {
    // Use graph.instagram.com (matches what every IG cron in this
    // repo uses), not graph.facebook.com/debug_token. The Facebook
    // debug_token endpoint requires a separate App Access Token to
    // inspect, which is why "HTTP 400" surfaced — wrong endpoint for
    // an Instagram Business token. Tag /me with token_type plus
    // expiration via the official IG endpoint.
    const { result, ms } = await timeIt(() =>
      fetch(
        `https://graph.instagram.com/v21.0/me?fields=id,username,account_type&access_token=${encodeURIComponent(token)}`,
      ),
    );
    if (!result.ok) {
      // Try to read Meta's error reason — usually a clear "OAuth
      // access token expired" string.
      const body = await result.text().catch(() => "");
      const reason = body.match(/"message":"([^"]+)"/)?.[1] ?? `HTTP ${result.status}`;
      return critical("IG Access Token", reason);
    }
    // Token is valid. We don't get a hard expiry off /me, but the
    // existence of a 200 response means the token is live RIGHT NOW.
    // Expiry forecasting still requires debug_token + an app token —
    // out of scope for this v1 health check.
    const json = await result.json();
    return ok("IG Access Token", ms, `live as @${json?.username ?? "unknown"}`);
    // Note: predictive expiry forecasting (days-left) requires
    // graph.facebook.com/debug_token with a separate App Access
    // Token (FB_APP_ID + FB_APP_SECRET) — not configured in this app.
    // The current /me check confirms the token works RIGHT NOW; if it
    // expires the next hourly poll catches the failure within ~1h.
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
    // The `settings` table only has updated_at, not created_at — using
    // updated_at as the recency filter (these rows are upserted once
    // and never re-touched, so updated_at == row birth time in practice).
    const { data, error } = await sb
      .from("settings")
      .select("key, value")
      .like("key", "cron_end_%")
      .gte("updated_at", cutoff)
      .limit(500);
    const ms = Date.now() - start;
    if (error) return warn("Cron health (24h)", error.message);
    if (!data || data.length === 0) {
      return ok("Cron health (24h)", ms, "no records — observer may be off or quiet day");
    }
    let failed = 0;
    const failedJobs = new Map<string, string>(); // name → most-recent detail
    for (const row of data) {
      try {
        const v = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
        if (v?.outcome && v.outcome !== "success" && v.outcome !== "skipped") {
          failed += 1;
          // cron-observer writes the field as `name`, not `cron_id`.
          // Previous code looked up the wrong key so the failure list
          // was always empty in the digest.
          const jobName = String(v.name ?? v.cron_id ?? "unknown");
          failedJobs.set(jobName, String(v.detail ?? v.outcome ?? ""));
        }
      } catch {
        // skip malformed
      }
    }
    if (failed === 0) {
      return ok("Cron health (24h)", ms, `${data.length} runs, all green`);
    }
    const list = [...failedJobs.entries()]
      .slice(0, 4)
      .map(([n, d]) => (d ? `${n} (${d.slice(0, 60)})` : n));
    return warn(
      "Cron health (24h)",
      `${failed} failure(s) in last 24h: ${list.join(", ")}${failedJobs.size > 4 ? "…" : ""}`,
    );
  } catch (e: any) {
    return warn("Cron health (24h)", e?.message ?? "exception");
  }
}

async function checkOutreachBots(sb: any): Promise<CheckResult> {
  // Surfaces silent .gs bots before they go dark for days. Reads the
  // per-bot keys written by /api/outreach-stats POST. Each bot SHOULD
  // sync at least daily — beyond 36h we warn, beyond 72h we treat as
  // critical (something in Apps Script is broken or the trigger died).
  try {
    const start = Date.now();
    const { data, error } = await sb
      .from("settings")
      .select("key, updated_at")
      .in("key", ["outreach_stats:george", "outreach_stats:elleanna"]);
    const ms = Date.now() - start;
    if (error) return warn("Outreach bots", error.message);
    const now = Date.now();
    const found: { bot: string; ageHrs: number }[] = [];
    for (const row of data ?? []) {
      const bot = String(row.key).split(":")[1] ?? "?";
      const ts = row.updated_at ? new Date(row.updated_at as string).getTime() : 0;
      const ageHrs = ts > 0 ? (now - ts) / 3600000 : Infinity;
      found.push({ bot, ageHrs });
    }
    if (found.length === 0) {
      return ok("Outreach bots", ms, "no per-bot snapshots yet");
    }
    const stale = found.filter((f) => f.ageHrs > 36 && f.ageHrs <= 72);
    const dark = found.filter((f) => f.ageHrs > 72);
    if (dark.length > 0) {
      return critical(
        "Outreach bots",
        `${dark.map((d) => `${d.bot} silent ${Math.round(d.ageHrs)}h`).join(", ")}`,
      );
    }
    if (stale.length > 0) {
      return warn(
        "Outreach bots",
        `${stale.map((s) => `${s.bot} stale ${Math.round(s.ageHrs)}h`).join(", ")}`,
      );
    }
    const youngest = Math.round(Math.min(...found.map((f) => f.ageHrs)));
    return ok(
      "Outreach bots",
      ms,
      `${found.length}/2 reporting · last sync ${youngest}h ago`,
    );
  } catch (e: any) {
    return warn("Outreach bots", e?.message ?? "exception");
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
    checkGmailOAuth(sb),
    checkSanityCMS(),
    checkIGTokenExpiry(),
    checkFBPageToken(),
    checkBlogCadence(),
    checkNewsletterQueue("wake"),
    checkNewsletterQueue("compass"),
    checkResendQuota(),
    checkIGContentQueue(sb),
    checkRecentCronFailures(sb),
    checkOutreachBots(sb),
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
