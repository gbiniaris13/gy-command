@README.md

# Working in this repo

You are a contributor to George's custom CRM. Read the README first
— architecture is split into three pillars (Inbox Brain, Smart
Contact DB, Greetings Engine) per the 27/04/2026 refocus brief.

## Conventions

- **Next.js 16** (Turbopack) — read `node_modules/next/dist/docs/`
  before relying on conventions from older Next versions.
- **Supabase REST silently caps at 1000 rows.** Every table walk
  must paginate explicitly with `.range()`. The `inbox-analyzer`,
  `inbox-backfill`, `inbox-cleanup-*`, `inbox-tag` and
  `religion-infer` endpoints all have battle-tested pagination
  loops you should copy.
- **Function timeout is 300s on Vercel.** Long jobs use the
  resumable-offset pattern (`?offset=NNN` returning `next_offset`).
  See `inbox-refresh` and `inbox-tag` for the canonical shape.
- **Auto-actions never auto-send.** Greetings, drafts, and
  classifications all stop at the Gmail draft / Telegram approval
  stage. Sending is George's hand on the keyboard.
- **Migrations live in `src/lib/*-migration.sql`.** Each is
  idempotent (`IF NOT EXISTS`). Apply via Supabase Studio when
  introducing a new schema field — there is no automated migration
  runner.
- **Activities table CHECK constraint was dropped** in
  `inbox-state-migration.sql` because the codebase writes far more
  type values than the original 11. Don't add it back — add to the
  set instead.

## Pillar 1.5 — Gmail STAR

George's manual signal beats every heuristic. Whenever you add a
new ranking modifier in `cockpit-engine.ts`, ensure the star boost
(+5,000,000) still dwarfs it. Stars sync every 15 min via the cron
and on every poll cycle for new inbound.

## Don't

- Don't use HubSpot tooling for this project — it's NOT the CRM.
  The CRM is right here in this repo.
- Don't drop or rename `inbox_*` columns without coordinating —
  they back the cockpit's primary surface.
- Don't add cron jobs for "what if" scenarios. Each cron is a
  liability (state, errors, Telegram noise) — only ship one when
  the work it does is being consumed.
- Don't bloat the cockpit. The brief explicitly demands
  "8-15 threads ranked by urgency" — when adding sections, ask
  whether George can act on them in the morning before coffee.
