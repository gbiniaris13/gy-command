# gy-command — Architecture

> **Purpose:** A persistent map of every subsystem in the CRM, written for
> future-Claude-when-coding (auto-loaded via CLAUDE.md `@import`) and for
> any human jumping into the repo cold. Updated on demand — re-run the
> audit prompt in PLAYBOOKS.md → "Refresh architecture docs" if the
> codebase shifts significantly.
>
> **Newsletter rule:** newsletter internals are deliberately out of
> scope here. We list the operator surface paths only — never the
> validator / router / sender mechanics. Those live in the public-site
> repo (`/Users/.../george-yachts`) and are owned there.

---

## Stack at a glance

- **Framework:** Next.js 16 (App Router, Turbopack). Read
  `node_modules/next/dist/docs/` before assuming any pre-16 convention
  applies — see `CLAUDE.md` Conventions.
- **DB:** Supabase Postgres. Service-role client via
  `src/lib/supabase-server.ts` (`createServiceClient()`). RLS bypassed
  in API routes by design.
- **Auth:** Supabase auth on `/dashboard/*` via `src/middleware.ts`.
  Anon flows redirect to `/login`.
- **AI:** Universal client `src/lib/ai.ts:1-73` — OpenAI SDK pointed at
  whatever provider `AI_BASE_URL` says (defaults to Gemini's OpenAI
  shim, free tier). Swap providers by env-var change only.
- **Hosting:** Vercel. Cron jobs declared in `vercel.json`. 300s
  function timeout; long jobs use the resumable-offset pattern (see
  `inbox-refresh`, `inbox-tag`, `health-score-recompute`).
- **Inter-service:** Telegram (rate-hardened sender + approval webhook),
  Google (Gmail / Calendar / Docs OAuth), Instagram Graph API, public
  site newsletter via `NEWSLETTER_PROXY_SECRET`.

---

## Subsystem catalogue

Each entry: 1-line purpose · key files (with line refs) · env vars ·
crons · external services · gotchas.

### 1. Cockpit Briefing Engine

The morning decision surface. AI-ranks contacts into "today's actions"
plus pulse + opportunities + commitments + charter milestones, caches
once per day, the cockpit dashboard reads the cache.

- **Files:** [src/lib/cockpit-engine.ts](src/lib/cockpit-engine.ts) ·
  [src/app/api/cron/cockpit-briefing/route.ts](src/app/api/cron/cockpit-briefing/route.ts) ·
  [src/app/api/cockpit/briefing/route.ts](src/app/api/cockpit/briefing/route.ts) ·
  [src/app/dashboard/page.tsx](src/app/dashboard/page.tsx) ·
  [src/app/dashboard/CockpitClient.tsx](src/app/dashboard/CockpitClient.tsx)
- **Env:** `AI_API_KEY`, `AI_MODEL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
  `SUPABASE_SERVICE_ROLE_KEY`
- **Cron:** `/api/cron/cockpit-briefing` @ `0 4 * * *` (04:00 UTC = 06:00 Athens)
- **External:** Gemini 2.5 Flash via `lib/ai.ts`; Telegram Bot API
- **Gotchas:**
  - `cockpit-engine.ts:94` — Sprint 2.1 Bug 9: threads with associated
    deals carry `expected_commission_eur` so the UI can drop the
    separate CRM-action section. Single source.
  - Defensive fallback queries when columns are missing — cockpit
    must never go blank (CLAUDE.md Conventions).
  - Star boost in scoring is `+5,000,000` and must dwarf any new
    ranking modifier you add.

### 2. Inbox / STAR / Message Classification

Pillar 1 + 1.5. Polls Gmail for new inbound, classifies messages
(`awaits_reply | informational | closing | declined | parked |
auto_response | reaction | unknown`), syncs Gmail STAR signal every
15 min, caches ranked thread state on contact rows.

- **Files:** [src/lib/inbox-analyzer.ts](src/lib/inbox-analyzer.ts) ·
  [src/lib/sentiment-classifier.ts](src/lib/sentiment-classifier.ts) ·
  [src/app/api/cron/inbox-refresh/route.ts](src/app/api/cron/inbox-refresh/route.ts) ·
  [src/app/api/cron/inbox-star-sync/route.ts](src/app/api/cron/inbox-star-sync/route.ts) ·
  [src/app/api/cron/gmail-poll-replies/route.ts](src/app/api/cron/gmail-poll-replies/route.ts) ·
  [src/app/api/admin/inbox-classify/route.ts](src/app/api/admin/inbox-classify/route.ts)
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY` (sentiment)
- **Crons:** `/api/cron/inbox-refresh` @ `30 3 * * *` ·
  `/api/cron/inbox-star-sync` @ `*/15 * * * *` ·
  `/api/cron/gmail-poll-replies` @ `*/5 * * * *`
- **Gotchas:**
  - Pagination: every walk of `activities` or `contacts` MUST
    `.range()` explicitly — Supabase REST silently caps at 1000.
  - `analyzeActivities` ignores noise classes (`auto_response`,
    `reaction`, `closing`, `declined`, `parked`) when computing "last
    meaningful message". This was the Villy Manolia fix.
  - The activities table CHECK constraint was DROPPED in
    `inbox-state-migration.sql`. Don't add it back — add new types to
    the set instead.
  - When filtering "is null" + updating, restart pagination from row 0
    each iteration (the filter shrinks the view as you write).

### 3. Charter Lifecycle (deal_id pages)

The 17-milestone charter journey from T-60 (intro) through T+annual
(post-charter follow-up). Auto-fires daily, drafts Gmail messages,
gates on document availability, cascades to guest network on T+0.

- **Files:** [src/lib/charter-lifecycle.ts](src/lib/charter-lifecycle.ts) ·
  [src/lib/charter-activation.ts](src/lib/charter-activation.ts) ·
  [src/lib/charter-doc-extractor.ts](src/lib/charter-doc-extractor.ts) ·
  [src/lib/charter-guest-cascade.ts](src/lib/charter-guest-cascade.ts) ·
  [src/lib/v3-charter-engine-migration.sql](src/lib/v3-charter-engine-migration.sql) ·
  [src/app/api/cron/charter-lifecycle-fire/route.ts](src/app/api/cron/charter-lifecycle-fire/route.ts) ·
  [src/app/api/cron/post-charter/route.ts](src/app/api/cron/post-charter/route.ts) ·
  [src/app/api/cron/charter-reminders/route.ts](src/app/api/cron/charter-reminders/route.ts) ·
  [src/app/dashboard/charters/](src/app/dashboard/charters/)
- **Env:** none subsystem-specific (uses Supabase + AI helper)
- **Crons:** `/api/cron/charter-lifecycle-fire` @ `30 4 * * *` ·
  `/api/cron/post-charter` @ `0 9 * * *` ·
  `/api/cron/charter-reminders` @ `0 8 * * *`
- **Tables:** `deals`, `charter_documents`, `charter_guests`,
  `charter_lifecycle_milestones`
- **Gotchas:**
  - `v3-charter-engine-migration.sql:18-22` — `contacts` row remains
    SOURCE OF TRUTH for the primary/most-recent deal so existing UI
    keeps working. Denormalised by design — do NOT switch to dual
    writes without migrating the entire UI surface.
  - Per-guest T+annual cascade is in scope for Sprint 3.11 (per
    user-memory `project_sprint_3_11.md`).

### 4. Outreach Bots (george / elleanna)

Two Google Apps Script bots auto-send email sequences to a sheet of
prospects. gy-command is the **observer**: it stores snapshot stats
in `settings` rows and renders a per-bot dashboard. The Apps Script
sheet is the source of truth.

- **Files:** [src/app/api/outreach-stats/route.ts](src/app/api/outreach-stats/route.ts) ·
  [src/app/dashboard/outreach/page.tsx](src/app/dashboard/outreach/page.tsx) ·
  [src/app/dashboard/outreach/OutreachClient.tsx](src/app/dashboard/outreach/OutreachClient.tsx) ·
  [src/app/api/sync/route.ts](src/app/api/sync/route.ts) (the bot's POST target)
- **Env:** none (HMAC-signed POST from Apps Script)
- **Settings keys:** `outreach_stats:george`, `outreach_stats:elleanna`
  (legacy: `outreach_stats` without bot suffix)
- **Gotchas:**
  - `outreach-stats/route.ts:20` — backwards-compatible: if the bot
    omits the `bot` discriminator, the snapshot lands in the legacy
    single key. Don't break this without coordinating with the
    Apps Script side.
  - Open opens/bounces tracking pending — see user-memory
    `project_outreach_opens_tracking.md`. Low priority.

### 5. Pillars 4 + 5 — Commitments + Health Score

P4 (the "differentiator" per the brief): extract promised deadlines
from outbound emails, surface overdue ones in the cockpit. P5:
composite 0-100 health score per contact (recency, sentiment,
reply_rate, deal_velocity, commitment_penalty, greetings_bonus).

- **Files:** [src/lib/health-scorer.ts](src/lib/health-scorer.ts) ·
  [src/lib/commitment-extractor.ts](src/lib/commitment-extractor.ts) ·
  [src/lib/v2-commitments-migration.sql](src/lib/v2-commitments-migration.sql) ·
  [src/app/api/cron/commitments-surface/route.ts](src/app/api/cron/commitments-surface/route.ts) ·
  [src/app/api/cron/health-score-recompute/route.ts](src/app/api/cron/health-score-recompute/route.ts) ·
  [src/app/api/cron/health-weekly-digest/route.ts](src/app/api/cron/health-weekly-digest/route.ts)
- **Env:** `AI_API_KEY` (commitment extraction lives inside the
  outbound send flow + the daily backfill cron)
- **Crons:** `/api/cron/commitments-surface` @ `0 5 * * *` ·
  `/api/cron/health-score-recompute` @ `30 2 * * *` ·
  `/api/cron/health-weekly-digest` @ `0 6 * * 0`
- **Tables:** `commitments`, `health_score_history`
- **Gotchas:**
  - Confidence threshold for auto-fulfillment is generous on purpose:
    "later send in same thread after the commitment's source_sent_at"
    counts as fulfilled. False fulfillments are easier to recover from
    than missed promises.
  - `health-scorer.ts` keeps base = 70, total clamped to 0-100. Don't
    let a new component blow past those bounds.
  - Sentiment classifications cache on `activities.sentiment_warmth /
    engagement / intent`. Add a backfill if you add a new
    sentiment-affecting field.

### 6. Brand Radar

Weekly AI brand mentions scan: queries Gemini on yacht/charter topics,
checks if "George Yachts" surfaces, tracks Share of Voice vs
competitors.

- **Files:** [src/lib/brand-radar-queries.ts](src/lib/brand-radar-queries.ts) ·
  [src/lib/brand-radar-migration.sql](src/lib/brand-radar-migration.sql) ·
  [src/app/api/cron/brand-radar/route.ts](src/app/api/cron/brand-radar/route.ts) ·
  [src/app/dashboard/brand-radar/](src/app/dashboard/brand-radar/)
- **Env:** `AI_API_KEY`, `AI_MODEL`
- **Cron:** `/api/cron/brand-radar` @ `0 6 * * 0` (Sundays 06:00 UTC)
- **Tables:** `brand_radar_scans`, `brand_radar_weekly`
- **Gotchas:**
  - "Already scanned today" guard returns latest weekly summary so the
    client doesn't render `undefined`.

### 7. Instagram Pipeline

End-to-end: AI-generated captions → optional approval gate (Telegram
inline buttons) → scheduled publish → analytics + underperformer
tracking + DM auto-reply + competitor watch.

- **Files:** [src/lib/caption-approval-gate.ts](src/lib/caption-approval-gate.ts) ·
  [src/lib/fleet-caption.ts](src/lib/fleet-caption.ts) ·
  [src/lib/fleet-rotation.ts](src/lib/fleet-rotation.ts) ·
  [src/lib/hashtag-guard.ts](src/lib/hashtag-guard.ts) ·
  [src/app/api/webhooks/telegram-approval/route.ts](src/app/api/webhooks/telegram-approval/route.ts) ·
  [src/app/api/cron/instagram-publish/route.ts](src/app/api/cron/instagram-publish/route.ts) ·
  [src/app/api/cron/instagram-analytics/route.ts](src/app/api/cron/instagram-analytics/route.ts) ·
  [src/app/dashboard/instagram/](src/app/dashboard/instagram/)
- **Env:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `IG_ACCESS_TOKEN`,
  `IG_BUSINESS_ID`, `DISABLE_IG_JITTER`
- **Crons (key ones — full list in PLAYBOOKS.md):**
  `/api/cron/instagram-publish` @ `5 15 * * *` ·
  `/api/cron/instagram-analytics` @ `17 */6 * * *` ·
  `/api/cron/instagram-generate-weekly` @ `0 7 * * 0`
- **Tables:** `ig_posts`, `ig_post_analytics`, `ig_competitors`,
  `ig_dm_replies`
- **Gotchas:**
  - `caption_auto_approve=true` by default → posts skip the Telegram
    gate. Set `settings.caption_auto_approve='false'` to re-enable
    the gate. Sprint 2.2 disabled the gate after a silent backlog of
    `pending_approval` rows that never went live.
  - `lib/telegram.ts` rate-hardening — see Subsystem #9.

### 8. Calendar / Gmail Integration

OAuth-backed sync of Google Calendar events + Gmail polling for new
replies + auto-reply drafts + AI thread suggestions.

- **Files:** [src/lib/google-api.ts](src/lib/google-api.ts) ·
  [src/lib/google-intel.ts](src/lib/google-intel.ts) ·
  [src/lib/auto-reply.ts](src/lib/auto-reply.ts) ·
  [src/lib/email-signature-parser.ts](src/lib/email-signature-parser.ts) ·
  [src/app/api/auth/gmail/](src/app/api/auth/gmail/) ·
  [src/app/api/cron/calendar-sync/route.ts](src/app/api/cron/calendar-sync/route.ts) ·
  [src/app/api/cron/gmail-poll-replies/route.ts](src/app/api/cron/gmail-poll-replies/route.ts) ·
  [src/app/api/cron/thread-suggestions/route.ts](src/app/api/cron/thread-suggestions/route.ts)
- **Env:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`, refresh tokens stored on
  `settings.gmail_refresh_token`
- **Crons:** `/api/cron/calendar-sync` @ `*/30 * * * *` ·
  `/api/cron/gmail-poll-replies` @ `*/5 * * * *` ·
  `/api/cron/thread-suggestions` @ `45 2 * * *`
- **Gotcha:** middleware redirects authed users from `/login` to
  `/dashboard/email` if `gmail_connected=true`, otherwise `/dashboard`.
  This is the only middleware-driven UX divergence (`src/middleware.ts:1-56`).

### 9. Telegram (rate-hardened sender + approval webhook)

Single bot owns: IG caption-approval inline-button callbacks,
`/status` text command (Tier 3a), and any direct sends from server.
**Newsletter approvals deliberately use URL inline buttons and do
NOT flow through this webhook.**

- **Files:** [src/lib/telegram.ts](src/lib/telegram.ts) ·
  [src/app/api/webhooks/telegram-approval/route.ts](src/app/api/webhooks/telegram-approval/route.ts) ·
  [src/app/api/telegram/send/route.ts](src/app/api/telegram/send/route.ts)
- **Env:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- **Webhook URL:** `https://gy-command.vercel.app/api/webhooks/telegram-approval`
- **Gotcha (telegram.ts:8-18):** Global `chain` promise serialises every
  send + min 1100ms gap. 429 responses honour `retry_after`. Hardened
  after the 2026-04-23 incident where ~40 HOT/WARM classifications
  fired in one tick and triggered a 429 storm. Don't bypass `chain`
  with raw `fetch`.

### 10. Newsletter Operator Surface (READ-ONLY here)

The operator UI for approving / sending campaigns is at
`/dashboard/newsletter`. **Internals belong to the public-site repo.**
File pointers only — never document validator/router/sender mechanics:

- [src/app/dashboard/newsletter/](src/app/dashboard/newsletter/) — operator UI
- [src/app/api/admin/newsletter-prep-issue-1/](src/app/api/admin/) — admin endpoints (multiple)
- [src/app/api/newsletter/unsubscribe/route.ts](src/app/api/newsletter/unsubscribe/route.ts)
- [src/lib/newsletter.ts](src/lib/newsletter.ts), [src/lib/newsletter-proxy.ts](src/lib/newsletter-proxy.ts) — proxy + helpers

Cross-repo bridge details live in
`/Users/.../george-yachts/SHARED_INTEGRATIONS.md` (Tier 4b).

### 11. Command Center

The unified ops dashboard (Tier 1+2+3 of the recent build): metrics,
priorities panel, executive grid, pipeline / systems / threats panels,
live activity terminal, Ask the Cockpit chat, kiosk mode, voice
briefing.

- **Files:** [src/lib/command-center-snapshot.ts](src/lib/command-center-snapshot.ts) ·
  [src/app/api/command-center/snapshot/route.ts](src/app/api/command-center/snapshot/route.ts) ·
  [src/app/api/command-center/ask/route.ts](src/app/api/command-center/ask/route.ts) ·
  [src/app/api/command-center/voice-brief/route.ts](src/app/api/command-center/voice-brief/route.ts) ·
  [src/app/dashboard/command-center/page.tsx](src/app/dashboard/command-center/page.tsx) ·
  [src/app/dashboard/command-center/CommandCenter.tsx](src/app/dashboard/command-center/CommandCenter.tsx) ·
  [src/app/dashboard/command-center/kiosk/](src/app/dashboard/command-center/kiosk/)
- **Env:** `AI_API_KEY` (Ask), `OPENAI_API_KEY` (voice — separate from
  AI_API_KEY because lib/ai.ts points at Gemini's OpenAI shim and TTS
  needs the real OpenAI base URL)
- **Cron:** none direct; reads the cockpit briefing cache at
  `settings.cockpit_briefing_<date>`
- **Gotchas:**
  - Snapshot helper is **single point of truth** for the page, kiosk,
    Telegram `/status`, and the Ask context bundle. Modify with care
    — every Tier-3 path will see the change.
  - The endpoint **never returns 500** — it falls through to
    `emptySnapshot()` so the dashboard never blanks.

### 12. Cron Observer + System Health Check

Lightweight instrumentation: every IG cron (and the commerce ones)
wraps its handler in `observeCron(name, fn)` to record START/END
rows. The Thursday weekly-ops-report cron computes uptime % from
those rows. The daily system-health-check looks for stuck states.

- **Files:** [src/lib/cron-observer.ts](src/lib/cron-observer.ts) ·
  [src/app/api/cron/system-health-check/route.ts](src/app/api/cron/system-health-check/route.ts) ·
  [src/app/api/cron/instagram-weekly-ops-report/route.ts](src/app/api/cron/instagram-weekly-ops-report/route.ts)
- **Cron:** `/api/cron/system-health-check` @ `5 7 * * *` (07:05 UTC)
- **Settings keys:** `cron_start_<runId>`, `cron_end_<runId>` (auto-pruned
  after 21 days)
- **Gotchas:**
  - Best-effort observability: if the settings write fails, the actual
    cron still runs and returns. Never blocks a real publish/reply.
  - START without END → classified as "timed out" by the weekly report.

### 13. AI Helper Layer (`lib/ai.ts`)

Universal OpenAI-SDK client pointed at whatever `AI_BASE_URL` says.
Defaults to Google's Gemini OpenAI-compat shim (free tier). One
function for `aiChat()` (single-shot) and one for `aiStream()` (chat).

- **File:** [src/lib/ai.ts](src/lib/ai.ts)
- **Env:** `AI_API_KEY`, `AI_BASE_URL`
  (default `https://generativelanguage.googleapis.com/v1beta/openai`),
  `AI_MODEL` (default `gemini-2.5-flash`)
- **Gotcha:** Strip markdown fences defensively in any parser — Gemini
  occasionally ignores the no-fence instruction.

---

## Cross-cutting concerns

- **Pagination.** Every walk over `activities`, `contacts`,
  `email_classifications` MUST `.range()` explicitly because Supabase
  REST silently caps at 1000 rows. The canonical loops live in
  `inbox-refresh`, `inbox-tag`, `inbox-cleanup-*`,
  `commitments-backfill`, `health-score-recompute`. Copy them.
- **Resumable offset.** Long jobs use `?offset=NNN` returning
  `next_offset` to stay inside Vercel's 300s. Canonical shapes:
  `inbox-refresh`, `inbox-tag`, `health-score-recompute`.
- **Auto-actions never auto-send.** Greetings, commitments, drafts,
  classifications all stop at the Gmail-draft / Telegram-approval
  stage. George's hand sends.
- **Migrations.** `src/lib/*-migration.sql`, all idempotent
  (`IF NOT EXISTS`). No automated runner — apply via Supabase Studio
  by hand.
- **Newsletter contention.** Bot webhook is owned by gy-command's
  flows; newsletter approvals use URL inline buttons specifically to
  stay out of contention. Don't break that contract.

---

## Where to look first

| If you're touching… | Read this first |
|---|---|
| Ranking / cockpit logic | [src/lib/cockpit-engine.ts](src/lib/cockpit-engine.ts) — types at top, scorer mid, ranker bottom |
| Email / inbox state | [src/lib/inbox-analyzer.ts](src/lib/inbox-analyzer.ts) |
| Charter pipeline | [src/lib/v3-charter-engine-migration.sql](src/lib/v3-charter-engine-migration.sql) (schema), then [src/lib/charter-lifecycle.ts](src/lib/charter-lifecycle.ts) |
| Health / commitments | [src/lib/health-scorer.ts](src/lib/health-scorer.ts) + [src/lib/v2-commitments-migration.sql](src/lib/v2-commitments-migration.sql) |
| IG flow | [src/lib/caption-approval-gate.ts](src/lib/caption-approval-gate.ts) (the gate you'll definitely hit) |
| Telegram / sending | [src/lib/telegram.ts](src/lib/telegram.ts) (read the rate-limit rant first) |
| Anything new on the Command Center | [src/lib/command-center-snapshot.ts](src/lib/command-center-snapshot.ts) — it's the single source |
| Schema lookup | DATA_MODEL.md (sibling file) |
| "How do I do X?" | PLAYBOOKS.md (sibling file) |
