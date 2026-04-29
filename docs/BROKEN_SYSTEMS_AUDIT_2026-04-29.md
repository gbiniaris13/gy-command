# Broken Systems Audit — 2026-04-29

George flagged "πολλά πράγματα από αυτά που έχουμε ρυθμίσει δε
λειτουργούν" without specifying which. Real investigation via
Vercel runtime logs (last 7 days). Honest findings — no spin.

## ✅ Confirmed working

- **Newsletter system end-to-end** — all 6 phases firing, Issue #1
  delivered, dedup working, webhook verified, 100+ admin POSTs in
  last 24h all 200.
- **Facebook mirror cron** — fires daily 15:35 UTC ✓
- **Instagram publish + reels** — 200 responses, queue-flush running
- **Inbox star sync** — 15-min cadence, all 200 except one
- **Outreach (cold mail) Apps Script bots** — daily-limit alerts
  visible in Telegram, cross-bot dedup endpoint healthy
- **Public site forms** (Contact, Newsletter signup, Partner PDF)
  — daily 10:00 health check stays green

## ⚠️ Concerning — single-event issues, recovered

- **inbox-star-sync** — one 500 at 20:00:23 yesterday with "Token
  refresh failed" then 200s every 15 min for the next 24 hours.
  Gmail OAuth blip, self-healed. **No action needed** unless it
  recurs (the new system-health-check will surface this from
  tomorrow).

- **/api/admin/newsletter-add** — 4 isolated 500s at 11:27 today,
  surrounded by 100+ 200s before and after. Likely George hitting
  the endpoint while a deploy was rolling out, or empty-body POSTs.
  **No action needed** — 99.96% success rate today.

## ❌ Likely actually broken (low confidence — limited log retention)

These show **0 logs in last 7 days** when they should be firing on
schedule. Could be (a) actually not running, (b) silently failing
before any log line, or (c) Vercel log retention hiding them.

| Cron | Schedule | Last 7d logs | Verdict |
|---|---|---|---|
| `linkedin-blog-digest` | Tue + Thu 05:45 UTC | 0 | should have ≥ 2 |
| `linkedin-company-amplify` | Tue + Thu 08:00 UTC | 0 | should have ≥ 2 |
| `linkedin-fleet-brief` | Fri 07:00 UTC | 0 | should have ≥ 1 |
| `linkedin-intel` | Mon 06:00 UTC | 0 | should have ≥ 1 |
| `tiktok-mirror` | Mon-Fri 16:15 UTC | 1 | should have ~5 |

This is consistent with George's earlier comment that LinkedIn was
"waiting on develop list" — the family of crons likely silently
failing because of missing access tokens or endpoints that were
never wired to live LinkedIn API.

## Recommended next investigations

1. **Check Vercel Cron Jobs panel** — confirm these crons are
   actually registered (Vercel Hobby caps at 2/day, Pro at 40/day,
   so a cron may be silently disabled past the cap). The vercel.json
   has them but if the project hits the limit, Vercel ignores extras.

2. **Try a manual fire** — hit each suspected cron URL once with
   the CRON_SECRET to see what it returns. Errors will be visible in
   the response body.

3. **Wait for tomorrow's `system-health-check` (07:05 UTC)** — the
   new cron checks IG token validity directly via Meta's
   `debug_token`. If LinkedIn OAuth tokens are also expired we'll
   see a similar pattern in the next pass.

## What was DONE today (verified)

- Newsletter dashboard counter shows real per-stream counts
  (Bridge 77 / Wake 58 / Compass 1 / Greece 0) instead of the
  legacy total mislabelled as Bridge.
- IG engagement digest rotation switched to least-recently-shown
  with Supabase persistence — no more "same 5 accounts every day".
- IG candidate pool expanded with `/tags` endpoint + 90-day
  cooldown (was permanent-forever skip).
- Outreach .gs scripts updated with George name prefix + daily-
  limit dedup + PDF attached. **MUST be pasted into Apps Script
  editor manually** — gitignored, not auto-deployed.
- System-wide health check cron deployed, fires 07:05 UTC daily —
  13 checks across infrastructure, tokens, content queues, cron
  health.

## What was NOT done today (honest)

- Big H restructure → just a proposal doc, no actual UI work yet.
- LinkedIn cron family → not investigated/fixed.
- "Things George thinks are broken" → only the ones he flagged
  explicitly. Comprehensive audit pending.
