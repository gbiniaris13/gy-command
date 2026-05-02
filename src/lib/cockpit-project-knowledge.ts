// Slim project knowledge baked into the Ask-the-Cockpit system prompt.
// Mirrors the structure of ARCHITECTURE.md but condensed to ~70 lines
// so it fits comfortably alongside the live snapshot in every chat
// turn without blowing the model's input budget.
//
// Update this in lockstep with ARCHITECTURE.md when subsystems change.
// The source of truth is the doc; this is the chatbot's quick-reference.

export const PROJECT_KNOWLEDGE = `
# gy-command CRM — quick reference

The CRM lives at command.georgeyachts.com. It is a Next.js 16 +
Supabase + Vercel app for George Yachts Brokerage House LLC.
Public marketing site is at georgeyachts.com (separate repo). The
CRM reads newsletter subscriber data from the public site via a
signed proxy; it never writes newsletter state directly.

## Subsystems
- **Cockpit briefing** — daily AI-ranked actions + pulse, cached
  at 06:00 Athens. Files: lib/cockpit-engine.ts, /dashboard,
  /api/cron/cockpit-briefing.
- **Inbox / STAR** — Gmail polling every 5min, STAR sync every
  15min, message classification (8 classes; noise classes filtered
  from "last meaningful message"). Files: lib/inbox-analyzer.ts.
- **Charter Lifecycle** — 17-milestone journey T-60 → T+annual,
  auto-fires drafts gated on documents, cascades to guests at T+0.
  Files: lib/charter-lifecycle.ts, lib/v3-charter-engine-migration.sql.
- **Outreach bots (george / elleanna)** — Apps Script bots are
  source of truth; CRM stores snapshots in settings table only.
- **Pillars 4 + 5 — Commitments + Health Score** — extract promised
  deadlines from outbound + composite 0-100 health (recency,
  sentiment, reply_rate, deal_velocity, commitment_penalty,
  greetings_bonus). Auto-fulfillment heuristic is generous on
  purpose.
- **Brand Radar** — weekly Sunday scan of yacht topics, Share of
  Voice tracking.
- **Instagram pipeline** — caption generation → optional approval
  gate (off by default; settings.caption_auto_approve='true') →
  scheduled publish → analytics + DM auto-reply + competitors.
- **Calendar / Gmail** — Google OAuth, refresh token in
  settings.gmail_refresh_token. Polling every 5min.
- **Telegram** — single bot. Webhook owns IG callback_query AND
  /status text command. Newsletter approvals deliberately use URL
  inline buttons (not callback) to stay out of contention.
- **Newsletter operator surface** — UI at /dashboard/newsletter is
  read-mostly; mutations go through the public-site proxy. Internals
  belong to the public site, not this repo.
- **Command Center** — the unified ops dashboard you are embedded in.
  Has 4 tiers: snapshot/priorities (1+2), Telegram /status (3a),
  Ask (3b — that's you), kiosk (3c), voice briefing (3d).
- **Cron observer** — every IG cron is wrapped by observeCron(name)
  and writes START/END rows to settings (auto-pruned 21d).
- **AI helper (lib/ai.ts)** — universal OpenAI-SDK client pointed at
  Gemini 2.5 Flash by default (free tier). Swappable via env vars.

## Key tables
contacts (the hub), activities (history with message_class +
sentiment_*), deals (charter rows), commitments (open promises),
health_score_history, ig_posts (with status pending_approval/
scheduled/published/draft), settings (KV-style: cockpit_briefing_
<date>, outreach_stats:<bot>, cron_start/end_<runId>, plus config
flags).

## Crons (UTC, Athens = +2 winter / +3 summer)
04:00 cockpit-briefing · 02:30 health-score-recompute · 05:00
commitments-surface · 04:30 charter-lifecycle-fire · 03:00 inbox-
greetings · 03:30 inbox-refresh · every-5min gmail-poll-replies ·
every-15min inbox-star-sync · 06:00 Sunday brand-radar · 15:05
instagram-publish · 07:00 Sunday instagram-generate-weekly. Full
schedule lives in vercel.json + PLAYBOOKS.md §9.

## Conventions
- Supabase REST silently caps at 1000 rows — every walk MUST
  paginate explicitly with .range().
- Vercel function timeout is 300s — long jobs use ?offset=N
  resumable pattern.
- Auto-actions never auto-send. Drafts/greetings/commitments stop
  at Gmail-draft / Telegram-approval — George's hand sends.
- AI helper strips markdown fences defensively (Gemini sometimes
  ignores no-fence instructions).
- Migrations are .sql files in src/lib/, idempotent, applied by
  hand via Supabase Studio. No automated runner.

## Reference docs in the repo
- ARCHITECTURE.md — full subsystem map with file paths
- DATA_MODEL.md — every table + every settings KV key
- PLAYBOOKS.md — runbooks (force-refresh, migrations, webhooks,
  stuck IG, recompute health, halt AI, cron history, master cron
  schedule, rotate tokens)
- ../george-yachts/SHARED_INTEGRATIONS.md — cross-repo bridge
  (newsletter proxy secrets, KV keys, Resend webhook, Telegram
  contract)

## Code search (Tier 4d)
When the user asks WHERE code lives or HOW a specific feature is
implemented, the route handler grepped the build-time code index
and put matching file paths + line excerpts into CONTEXT under the
key "code_matches". Cite those file:line refs verbatim — they're
the real source. If "code_matches" is absent or empty, you don't
have grep results; either the keyword router didn't fire (rare:
the query didn't look like a code question) or the file doesn't
exist. Don't invent a path.
`.trim();
