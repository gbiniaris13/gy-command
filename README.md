# GY Command Center

George Yachts' custom CRM + automation hub. Hosted on Vercel,
backed by Supabase, AI by Gemini (free tier) via OpenAI-compatible
endpoint. **Not** HubSpot.

Live: https://command.georgeyachts.com

---

## Architecture (refocus brief v2)

```
src/
├── app/
│   ├── dashboard/                # Cockpit + module UIs
│   │   ├── page.tsx              # Cockpit (the ONE page)
│   │   ├── CockpitClient.tsx     # Commitments + Inbox Brain + Greetings + Pulse
│   │   ├── contacts/             # CRM contact list + detail (with tag editor + health)
│   │   ├── email/                # Gmail inbox UI (classify/star/send)
│   │   ├── instagram/            # IG publishing + analytics
│   │   ├── ...
│   │   └── legacy/               # Pre-cockpit 14-widget kitchen sink (parked)
│   └── api/
│       ├── cockpit/              # Briefing + draft + chat endpoints
│       ├── crm/                  # Contacts CRUD, charter, tags-v2, commitments fulfill/dismiss
│       ├── cron/                 # 50 Vercel-scheduled jobs (see vercel.json)
│       ├── admin/                # One-shot ops endpoints (see below)
│       ├── gmail/                # Inbox / send / star / classify
│       ├── instagram/            # Publish / analytics / DM
│       ├── linkedin/             # Comment / safety / log
│       └── webhooks/             # ManyChat / Telegram / IG
└── lib/
    ├── cockpit-engine.ts         # Central decision engine (Pillars 1+1.5+4+5)
    ├── inbox-analyzer.ts         # Per-contact thread state (filters noise classes)
    ├── message-classifier.ts     # auto_response/reaction/closing/declined/parked/etc
    ├── pillar2-tagger.ts         # AI category tagger (travel_advisor/b2b_partner/...)
    ├── pillar3-holidays.ts       # Easter/Eid/Diwali/Hanukkah dates
    ├── pillar3-greek-namedays.ts # Greek Orthodox name day calendar
    ├── pillar3-religion-inferrer.ts (Greek-name-first, no Western default)
    ├── pillar3-greeting-templates.ts
    ├── commitment-extractor.ts   # Pillar 4 — promises in outbound
    ├── sentiment-classifier.ts   # Pillar 5 — per-message warmth/engagement/intent
    ├── health-scorer.ts          # Pillar 5 — composite 0-100 with components
    ├── thread-suggester.ts       # Sprint 2.2 — AI one-line suggestions + composite priority
    └── *-migration.sql           # Paste each into Supabase Studio once
```

---

## The five pillars

### 1. Inbox Brain
Cockpit reads Gmail thread state per contact (gap, direction,
owed-reply detection on the **last meaningful message** — auto-
responses, reactions, closing pleasantries, explicit declines, and
self-parking are filtered). Surfaces what George needs to reply to
today, ranked.

### 1.5 Gmail STAR signal
George stars threads in Gmail. Starred contacts rocket to the top
of the cockpit (+5,000,000 boost) regardless of other heuristics.
Sync runs every 15 min.

### 2. Smart Contact Database
Multi-tag categories per contact: `travel_advisor`, `charter_client`,
`b2b_partner`, `press`, `vendor`, `cold_lead`. Confidence per tag,
chip toggle UI on contact detail page, manual override permanent
(AI tagger never reverts). New contacts auto-tagged within 5 min
of first email.

### 3. Relationship Maintenance Engine
Auto-DRAFTS culturally-appropriate greetings on birthdays, name
days (Greek), and 12 holiday types per inferred religion + country.
Never auto-sends. Cockpit shows "📬 N drafts ready" with deep link
to Gmail label.

### 4. Promised Commitments Tracker
Every outbound email gets scanned for commitment language ("I'll
send X by Monday"). Promises with deadlines surface at the TOP of
the cockpit (broken promises trump unread emails). Auto-fulfilled
when George sends a follow-up in the same thread; one-click
"✓ Done" / "✕ Skip" buttons.

### 5. Relationship Health Score
0-100 score per contact computed nightly. Combines recency +
sentiment + reply rate + deal velocity + commitment penalty +
greetings bonus. Trend (↑↓→) computed against 7-day-old history.
Weekly Telegram digest of top 10 warming + top 10 cooling
contacts. Color-coded chip on every cockpit thread row.

---

## Sprint 2.2 quality refinements (v2 brief)

- **Composite priority score 0-100** per thread (separate from
  rank_score) — surfaced as P{N} chip on the cockpit row with a
  hover tooltip explaining why this thread is here.
- **AI-generated suggested action** per top-30 thread, in italic
  green above the snippet. "Reply to Villy's meeting request —
  offer 3 slots in her 20-24 April window (now overdue)".
- **Default cockpit cap 25** (was 60), with "Show all N" expander.

---

## Admin operations

| Endpoint | Purpose |
|---|---|
| `/api/admin/inbox-backfill?days=180` | Import Gmail history (chunked via `?pageToken=`) |
| `/api/admin/inbox-debug?email=X` | Inspect one contact's state + Gmail probe |
| `/api/admin/inbox-classify?ai=1` | Backfill message_class (heuristics + AI fallback) |
| `/api/admin/inbox-classify-debug?email=X` | Per-activity message_class dump |
| `/api/admin/inbox-tag-debug?email=X` | See raw AI tagger response for one contact |
| `/api/admin/inbox-tag` | Bulk re-tag (`?force=1` to ignore 30-day skip) |
| `/api/admin/inbox-cleanup-warmup?apply=1` | Delete cold-email warmup contacts |
| `/api/admin/inbox-cleanup-noise-emails?apply=1` | Delete noise contacts (DMARC/invoices/etc) |
| `/api/admin/inbox-create-contact?email=X&first=Y&last=Z` | Manual contact + Gmail import |
| `/api/admin/religion-infer` | Populate `inferred_religion` |
| `/api/admin/greetings-smoketest?email=X` | End-to-end Pillar 3 verification |
| `/api/admin/commitments-backfill?days=14` | Pillar 4 backfill from Gmail history |
| `/api/admin/sentiment-backfill?limit=200` | Pillar 5 sentiment on inbound emails |
| `/api/cron/health-score-recompute` | Recompute health for all eligible contacts |
| `/api/cron/thread-suggestions` | Refresh AI suggestions on top-30 threads |

---

## Migrations to apply (Supabase Studio → SQL Editor, in order)

All idempotent (`IF NOT EXISTS`).

1. `src/lib/inbox-state-migration.sql`             (Pillar 1)
2. `src/lib/inbox-starred-migration.sql`           (Pillar 1.5)
3. `src/lib/pillar2-tagging-migration.sql`         (Pillar 2)
4. `src/lib/pillar3-greetings-migration.sql`       (Pillar 3)
5. `src/lib/v2-message-class-migration.sql`        (Sprint 2.1 bug fixes)
6. `src/lib/v2-commitments-migration.sql`          (Pillar 4)
7. `src/lib/v2-health-score-migration.sql`         (Pillar 5)
8. `src/lib/v2-thread-suggestion-migration.sql`    (Sprint 2.2 quality)

---

## Parked modules (per refocus brief)

These remain accessible by direct URL but are hidden from the main
nav until the underlying flow is rebuilt or verified-in-use:

- `/dashboard/outreach` — Apps Script bot integration not yet rebuilt
- `/dashboard/visitors` — return-visitor tracker not user-validated
- `/dashboard/command-center` — decorative mock-data page; the real
  cockpit is `/dashboard`
- `/dashboard/legacy` — pre-cockpit 14-widget kitchen sink

To unpark: remove `parked: true` from the entry in
`src/app/dashboard/layout.tsx`.

---

## Stack

- **Next.js 16.2.2** (App Router, Turbopack)
- **TypeScript 5**, **React 19.2**, **Tailwind v4**
- **Supabase** (Postgres + Storage + Auth)
- **Gemini 2.5 Flash** via OpenAI-compatible endpoint (free tier)
- **Vercel** hosting + cron

## Env vars (Vercel project settings)

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_API_KEY` (Gemini)
- `AI_MODEL` (default `gemini-2.5-flash`)
- `AI_BASE_URL` (default Gemini OpenAI-compat endpoint)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- IG / FB / TikTok / LinkedIn tokens (see relevant lib files)
