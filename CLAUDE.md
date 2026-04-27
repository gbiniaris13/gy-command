@README.md

# Working in this repo

You are a contributor to George's custom CRM. Read the README first
— architecture is split into FIVE pillars (Inbox Brain, STAR signal,
Smart Contact DB, Greetings, Commitments, Health Score) per the
27/04/2026 refocus brief v2.

## Conventions

- **Next.js 16** (Turbopack) — read `node_modules/next/dist/docs/`
  before relying on conventions from older Next versions.
- **Supabase REST silently caps at 1000 rows.** Every table walk
  must paginate explicitly with `.range()`. The `inbox-analyzer`,
  `inbox-backfill`, `inbox-cleanup-*`, `inbox-tag`,
  `religion-infer`, `commitments-backfill`, `health-score-recompute`
  endpoints all have battle-tested pagination loops you should copy.
  When filtering for "is null" + updating, restart from row 0 each
  iteration (the filter shrinks the view as you write — see
  `inbox-classify`).
- **Function timeout is 300s on Vercel.** Long jobs use the
  resumable-offset pattern (`?offset=NNN` returning `next_offset`).
  See `inbox-refresh`, `inbox-tag`, `health-score-recompute` for
  the canonical shape.
- **Auto-actions never auto-send.** Greetings, commitments,
  drafts, classifications all stop at the Gmail draft / Telegram
  approval stage. Sending is George's hand on the keyboard.
- **Migrations live in `src/lib/*-migration.sql`.** Each is
  idempotent (`IF NOT EXISTS`). Apply via Supabase Studio when
  introducing a new schema field — there is no automated migration
  runner. Cockpit-engine has defensive fallback queries so missing
  columns degrade gracefully (cockpit doesn't go blank).
- **Activities table CHECK constraint was dropped** in
  `inbox-state-migration.sql` because the codebase writes far more
  type values than the original 11. Don't add it back — add to the
  set instead.

## Pillar 1.5 — Gmail STAR

George's manual signal beats every heuristic. Whenever you add a
new ranking modifier in `cockpit-engine.ts`, ensure the star boost
(+5,000,000) still dwarfs it. Stars sync every 15 min via the cron
and on every poll cycle for new inbound.

## Sprint 2.1 — Message classification (THE root fix for v2 bugs)

Every email_inbound carries a `message_class`:
  awaits_reply | informational | closing | declined | parked |
  auto_response | reaction | unknown

The analyzer (`analyzeActivities`) ignores noise classes (the last
five) when computing "last meaningful message". This fixes the
Villy Manolia case (her real meeting request was being shadowed by
an OOO that arrived 12 hours earlier).

When you change classifier behaviour, re-run
`/api/admin/inbox-classify?force=1` then `/api/cron/inbox-refresh`
to propagate.

## Pillar 4 — Commitments

The brief calls this the differentiator. The extractor runs on
EVERY outbound (live in `/api/gmail/send`, plus the daily
backfill cron over Gmail's in:sent). Confidence threshold for the
auto-fulfillment heuristic is "later send in same thread after the
commitment's source_sent_at" — generous on purpose, since false
fulfillments are easier to recover from than missed promises.

## Pillar 5 — Health Score

Composite formula in `health-scorer.ts`. The five components
(recency, sentiment, reply_rate, deal_velocity, commitment_penalty,
greetings_bonus) are documented inline. When tuning, keep the base
at 70 and the total clamped to 0-100.

Sentiment classifications are CACHED on
`activities.sentiment_warmth/engagement/intent` so the nightly
recompute doesn't pay the AI again per message. If you add a new
sentiment-affecting field, bump the column and add a backfill.

## Sprint 2.2 — Composite priority + AI suggestions

`compositePriorityScore` is a pure function (no DB / AI) — call it
freely. `suggestAction` is AI-driven; cache aggressively on
`contacts.next_touch_suggestion` and only regenerate when the
state changes (compare `inbox_analyzed_at` to
`next_touch_suggestion_at`).

## Don't

- Don't use HubSpot tooling for this project — it's NOT the CRM.
  The CRM is right here in this repo.
- Don't drop or rename `inbox_*`, `health_*`, or `commitments`
  columns without coordinating — they back the cockpit's primary
  surface.
- Don't add cron jobs for "what if" scenarios. Each cron is a
  liability (state, errors, Telegram noise) — only ship one when
  the work it does is being consumed.
- Don't bloat the cockpit. The brief explicitly demands
  "8-15 threads ranked by urgency" — when adding sections, ask
  whether George can act on them in the morning before coffee.
- Don't fight the AI when it returns markdown fences — strip them
  defensively in the parser. Gemini sometimes ignores the no-fence
  instruction.
