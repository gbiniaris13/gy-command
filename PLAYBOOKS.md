# gy-command — Playbooks

> **Purpose:** Step-by-step runbooks for common operations. Sibling
> docs: ARCHITECTURE.md (subsystems), DATA_MODEL.md (schema).

---

## Table of contents

1. [Force-refresh today's cockpit briefing](#1-force-refresh-todays-cockpit-briefing)
2. [Apply a new schema migration](#2-apply-a-new-schema-migration)
3. [Set / rotate the Telegram bot webhook URL](#3-set--rotate-the-telegram-bot-webhook-url)
4. [Trigger a manual outreach bot snapshot](#4-trigger-a-manual-outreach-bot-snapshot)
5. [Diagnose a stuck IG caption approval](#5-diagnose-a-stuck-ig-caption-approval)
6. [Force-recompute health scores](#6-force-recompute-health-scores)
7. [Halt AI calls in an emergency](#7-halt-ai-calls-in-an-emergency)
8. [Read recent cron run history](#8-read-recent-cron-run-history)
9. [Master cron schedule](#9-master-cron-schedule)
10. [Refresh these architecture docs](#10-refresh-these-architecture-docs)
11. [Add a new cron job (the right way)](#11-add-a-new-cron-job-the-right-way)
12. [Rotate a third-party token](#12-rotate-a-third-party-token)

---

## 1. Force-refresh today's cockpit briefing

The briefing is cached in `settings.cockpit_briefing_<YYYY-MM-DD>`
once per day by the 04:00 UTC cron. To rebuild on demand:

```bash
# Either: hit the briefing endpoint with ?fresh=1 (bypasses cache)
curl -s "https://gy-command.vercel.app/api/cockpit/briefing?fresh=1"

# Or: from the dashboard, click "Refresh briefing" (sticky quick-nav)
```

Code path: [src/app/api/cockpit/briefing/route.ts:16-47](src/app/api/cockpit/briefing/route.ts) — when
`fresh=1`, skips cache read and calls `buildBriefing(sb)` then upserts
the new value.

**When to do this:** after a manual schema change, after a seed run,
when the morning briefing looks stale by mid-afternoon.

**What it touches:** writes one row to `settings`. Idempotent.

---

## 2. Apply a new schema migration

There is **no automated migration runner**. Migrations live as
`src/lib/<feature>-migration.sql` files, all idempotent (`IF NOT
EXISTS`).

```text
1. Write the .sql file in src/lib/.
2. Open Supabase Studio → SQL Editor.
3. Paste the file content. Run.
4. Verify: \d <table_name>  (check columns + indexes).
5. Commit the .sql file. Note: applying != committing.
6. Update DATA_MODEL.md with the new table/columns.
```

**Safe pattern:** every migration starts with `CREATE TABLE IF NOT
EXISTS`, every column add uses `ADD COLUMN IF NOT EXISTS`, every index
uses `CREATE INDEX IF NOT EXISTS`. If you need to drop something,
write it as a separate migration file with a `-- DESTRUCTIVE` header
comment and confirm with George before running.

**Defensive coding:** the cockpit-engine has fallback queries when
columns are missing. New code should follow that pattern (try the new
column, fall back if it doesn't exist) so a migration not yet applied
doesn't break production.

---

## 3. Set / rotate the Telegram bot webhook URL

Telegram bots can have **only one webhook URL** at a time. The
gy-command bot's webhook owns:

- IG caption-approval `callback_query` taps
- `/status` and `/cockpit` text commands (Tier 3a)

Webhook target: `https://gy-command.vercel.app/api/webhooks/telegram-approval`

```bash
# Set / rotate (replace <token>):
curl -s "https://api.telegram.org/bot<token>/setWebhook?url=https://gy-command.vercel.app/api/webhooks/telegram-approval"

# Verify:
curl -s "https://api.telegram.org/bot<token>/getWebhookInfo"
```

**Newsletter must NOT use this webhook.** Newsletter approvals on the
public site use **URL inline buttons** (not callback buttons)
specifically to stay out of contention.

---

## 4. Trigger a manual outreach bot snapshot

Bot snapshots come from Google Apps Script POSTing to `/api/sync`.
There is no in-repo trigger to make the bot run; the Apps Script
schedule lives in Google.

To **simulate** a snapshot landing (useful for dashboard testing):

```bash
curl -X POST https://gy-command.vercel.app/api/sync \
  -H "Content-Type: application/json" \
  -d '{
    "bot": "george",
    "stats": { "sent_today": 12, "opens": 3, "replies": 1 },
    "ts": "2026-05-02T09:00:00Z"
  }'
```

The handler is at [src/app/api/outreach-stats/route.ts](src/app/api/outreach-stats/route.ts) (and
[src/app/api/sync/route.ts](src/app/api/sync/route.ts)). With no `bot` field, the snapshot lands
in the legacy `outreach_stats` key — backward-compat preserved.

---

## 5. Diagnose a stuck IG caption approval

**Default behaviour:** `caption_auto_approve = true` → captions skip
the gate and auto-publish. The gate exists for the rare case George
wants to review captions before they go live.

**Symptom:** posts piling up at `ig_posts.status = 'pending_approval'`.

```sql
-- 1. Confirm the gate is active
SELECT value FROM settings WHERE key = 'caption_auto_approve';
-- If this returns 'false', the gate is on. Default is 'true'.

-- 2. Inspect stuck rows
SELECT id, status, scheduled_time, created_at
FROM ig_posts
WHERE status = 'pending_approval'
  AND created_at < now() - interval '6 hours'
ORDER BY created_at DESC;

-- 3a. Quick fix — flip them all to scheduled (publish cron picks up)
UPDATE ig_posts SET status = 'scheduled'
WHERE status = 'pending_approval'
  AND created_at < now() - interval '6 hours';

-- 3b. Or kill the gate entirely
UPDATE settings SET value = 'true' WHERE key = 'caption_auto_approve';
```

Then check Telegram delivered the approval card with inline buttons
(if not, the bot rate-limit or webhook is the culprit — see runbook 3
+ check [src/lib/telegram.ts](src/lib/telegram.ts) `chain` serialisation).

Code: [src/lib/caption-approval-gate.ts](src/lib/caption-approval-gate.ts).

---

## 6. Force-recompute health scores

Health scores recompute nightly via cron `/api/cron/health-score-
recompute` @ `30 2 * * *`. To rerun on demand:

```bash
# Standard run (paginates over all active contacts)
curl -s "https://gy-command.vercel.app/api/cron/health-score-recompute"

# Resumable: if you got interrupted, pass next_offset
curl -s "https://gy-command.vercel.app/api/cron/health-score-recompute?offset=2000"
```

The resumable-offset pattern is documented in
[src/lib/health-scorer.ts](src/lib/health-scorer.ts). Verify by querying
`health_score_history` for today's `created_at` rows.

**When NOT to do this:** during work hours — the recompute hammers
Supabase + the AI provider. Outside business hours preferred.

---

## 7. Halt AI calls in an emergency

There is no built-in circuit-breaker. Three options, fastest to slowest:

```text
A. Revoke the AI key:
   Vercel project → Environment Variables → delete AI_API_KEY → redeploy.
   In-flight requests will fail; new ones will throw "AI_API_KEY not configured".

B. Point at a dummy provider:
   Set AI_BASE_URL to https://example.invalid → next request errors out.
   Faster than a redeploy if you can edit env vars without restart.

C. Disable specific crons:
   Comment out their entry in vercel.json and redeploy.
   Surgical but slower — needs a deploy.
```

**Voice briefing (Tier 3d):** uses `OPENAI_API_KEY` separately. Halting
AI calls via the AI_* knobs does NOT stop voice. Revoke
`OPENAI_API_KEY` separately if needed.

---

## 8. Read recent cron run history

Every IG / commerce cron is wrapped by `observeCron(name, fn)` and
writes START/END rows into `settings`. Auto-pruned after 21 days.

```sql
-- Last 100 runs, newest first
SELECT key, value, updated_at
FROM settings
WHERE key LIKE 'cron_start_%' OR key LIKE 'cron_end_%'
ORDER BY updated_at DESC
LIMIT 100;

-- Find timeouts (START without END)
SELECT s.key, s.value, s.updated_at
FROM settings s
WHERE s.key LIKE 'cron_start_%'
  AND s.updated_at > now() - interval '24 hours'
  AND NOT EXISTS (
    SELECT 1 FROM settings e
    WHERE e.key = REPLACE(s.key, 'cron_start_', 'cron_end_')
  );
```

The Thursday `instagram-weekly-ops-report` cron does this aggregation
and posts a summary to Telegram. Code:
[src/lib/cron-observer.ts](src/lib/cron-observer.ts).

---

## 9. Master cron schedule

All schedules in `vercel.json`. Times are UTC. Athens is UTC+3
(summer) or UTC+2 (winter). Categorised:

### System / decision surfaces

| Time (UTC) | Endpoint | Purpose |
|---|---|---|
| `0 4 * * *` | cockpit-briefing | Daily action ranking + pulse cache |
| `30 3 * * *` | inbox-refresh | Recompute inbox state for all contacts |
| `*/15 * * * *` | inbox-star-sync | Mirror Gmail STAR signal |
| `5 7 * * *` | system-health-check | Predictive warnings + stuck-state scan |

### Email / Calendar

| Time | Endpoint | Purpose |
|---|---|---|
| `*/5 * * * *` | gmail-poll-replies | Pull new inbound + run extractors |
| `*/30 * * * *` | calendar-sync | Mirror Google Calendar |
| `45 2 * * *` | thread-suggestions | AI suggestions per active thread |

### Charters

| Time | Endpoint | Purpose |
|---|---|---|
| `30 4 * * *` | charter-lifecycle-fire | Fire today's milestones |
| `0 9 * * *` | post-charter | T+0 onward follow-ups |
| `0 8 * * *` | charter-reminders | Pre-charter reminders to George |

### Pillars 4 + 5

| Time | Endpoint | Purpose |
|---|---|---|
| `0 5 * * *` | commitments-surface | Surface overdue promises |
| `30 2 * * *` | health-score-recompute | Nightly score recomputation |
| `0 6 * * 0` | health-weekly-digest | Sunday weekly digest |

### Instagram (selected — full set in vercel.json)

| Time | Endpoint | Purpose |
|---|---|---|
| `5 15 * * *` | instagram-publish | Publish scheduled posts |
| `17 */6 * * *` | instagram-analytics | 4×/day analytics pull |
| `0 7 * * 0` | instagram-generate-weekly | Sunday batch generate |
| `30 6 * * *` | instagram-watchdog | Stuck-post detection |
| `0 7 * * 4` | instagram-weekly-ops-report | Thursday Telegram summary |

### Outreach / brand / social

| Time | Endpoint | Purpose |
|---|---|---|
| `0 6 * * 0` | brand-radar | Sunday brand mentions scan |
| `45 5 * * 2,4` | linkedin-blog-digest | Tue/Thu LinkedIn |
| `0 8 * * 2,4` | linkedin-company-amplify | Tue/Thu amplify |
| `0 7 * * 5` | linkedin-fleet-brief | Friday fleet brief |
| `35 15 * * *` | facebook-mirror | Daily FB sync |
| `15 16 * * 1-5` | tiktok-mirror | Weekday TikTok |

### Greetings / cultural

| Time | Endpoint | Purpose |
|---|---|---|
| `0 8 * * *` | birthdays | Today's birthdays |
| `0 8 * * *` | holidays | Today's name-days/holidays |
| `0 3 * * *` | inbox-greetings | Auto-draft greetings (no auto-send) |

### Strategy

| Time | Endpoint | Purpose |
|---|---|---|
| `0 14 * * 5` | weekly-strategy | Friday strategy snapshot |
| `0 15 * * 5` | founders-friday | Friday founders update |
| `0 7 * * 0` | charter-whispers | Sunday whisper-network briefing |
| `0 10 * * 0` | competitor-scan | Sunday competitor scan |

---

## 10. Refresh these architecture docs

The codebase shifts. ARCHITECTURE.md / DATA_MODEL.md / PLAYBOOKS.md
should be regenerated when:

- A new subsystem is added (e.g. a new `pillar*-` lib + cron)
- A migration adds a new table
- The cron schedule shifts non-trivially
- An incident reveals a "gotcha" worth recording

Procedure:

```text
1. In gy-command, start a Claude Code session.
2. Ask: "Re-audit and refresh ARCHITECTURE.md, DATA_MODEL.md, and
   PLAYBOOKS.md. Compare against the current code and update only
   the deltas. Don't reorganise — just patch."
3. Review the diff, commit.
```

Don't rewrite end-to-end every time — incremental updates are fine
and preserve link continuity.

---

## 11. Add a new cron job (the right way)

The CLAUDE.md rule: "don't add cron jobs for 'what if' scenarios. Each
cron is a liability." Pre-flight checklist:

```text
[ ] Is the work it does already being consumed somewhere? If no, stop.
[ ] Can an existing cron absorb the work? If yes, prefer that.
[ ] Will it run while George is online? If yes, schedule outside
    business hours.
[ ] Does it call AI? Budget the cost × frequency. Document in the
    PR description.
[ ] Wrap with observeCron() so it shows up in the weekly report.
[ ] Use the pagination + resumable-offset pattern if walking a table.
[ ] Add an entry to PLAYBOOKS.md §9 (master schedule) when shipping.
```

Skeleton:

```ts
// /api/cron/<name>/route.ts
import { NextResponse } from "next/server";
import { observeCron } from "@/lib/cron-observer";
import { createServiceClient } from "@/lib/supabase-server";

async function _impl() {
  const sb = createServiceClient();
  // ...do work...
  return NextResponse.json({ ok: true, processed: 0 });
}

export async function GET() {
  return observeCron("<name>", () => _impl());
}
```

Add to `vercel.json` `crons` array with a UTC schedule.

---

## 12. Rotate a third-party token

| Token | Where stored | What breaks on rotation |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Vercel env | Bot stops sending. After rotation also re-run setWebhook (runbook 3). |
| `AI_API_KEY` | Vercel env | All AI features (cockpit ranking, sentiment, brand-radar, ask). No silent fallback. |
| `OPENAI_API_KEY` | Vercel env | Voice briefing only (Tier 3d). Other AI features are unaffected because they go through `lib/ai.ts` → Gemini. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env | Everything. Treat as a deploy. |
| `IG_ACCESS_TOKEN` | Vercel env | All IG features. Long-lived FB user token. Rotate every ~60d. |
| Google OAuth refresh token | `settings.gmail_refresh_token` | Gmail polling + Calendar sync. Re-auth via dashboard `/dashboard/email` flow. |
| `NEWSLETTER_PROXY_SECRET` | both repos (Vercel env) | The cross-repo proxy stops 401-ing. Coordinate with the public site. |

After rotation: redeploy both gy-command and (if applicable) the
public site. Test the affected subsystem with a smoke endpoint before
walking away.
