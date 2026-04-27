# GY Command Center

George Yachts' custom CRM + automation hub. Hosted on Vercel,
backed by Supabase, AI by Gemini (free tier) via OpenAI-compatible
endpoint. **Not** HubSpot.

Live: https://command.georgeyachts.com

---

## Architecture

```
src/
├── app/
│   ├── dashboard/                # Cockpit + module UIs
│   │   ├── page.tsx              # Cockpit (the ONE page)
│   │   ├── CockpitClient.tsx     # Inbox Brain + actions + greetings + pulse
│   │   ├── contacts/             # CRM contact list + detail
│   │   ├── email/                # Gmail inbox UI (classify/star/send)
│   │   ├── instagram/            # IG publishing + analytics
│   │   ├── ...
│   │   └── legacy/               # Pre-cockpit 14-widget kitchen sink
│   └── api/
│       ├── cockpit/              # Briefing + draft + chat endpoints
│       ├── crm/                  # Contacts CRUD, charter, tags-v2
│       ├── cron/                 # 47 Vercel-scheduled jobs (see vercel.json)
│       ├── admin/                # One-shot ops endpoints (see below)
│       ├── gmail/                # Inbox / send / star / classify
│       ├── instagram/            # Publish / analytics / DM
│       ├── linkedin/             # Comment / safety / log
│       └── webhooks/             # ManyChat / Telegram / IG
└── lib/
    ├── cockpit-engine.ts         # Central decision engine (Pillar 1+1.5)
    ├── inbox-analyzer.ts         # Per-contact thread state
    ├── pillar2-tagger.ts         # AI category tagger
    ├── pillar3-holidays.ts       # Easter/Eid/Diwali/Hanukkah dates
    ├── pillar3-greek-namedays.ts # Greek Orthodox name day calendar
    ├── pillar3-religion-inferrer.ts
    ├── pillar3-greeting-templates.ts
    └── *-migration.sql           # Paste each into Supabase Studio once
```

---

## The three pillars

The 27/04/2026 refocus brief reorganised the system around three pillars:

### 1. Inbox Brain
Cockpit reads Gmail thread state per contact (gap, direction,
owed-reply detection) — not just CRM stage. Surfaces what George
needs to reply to today, ranked.

**Powered by:**
- `src/lib/inbox-analyzer.ts` — derives stage from activities timeline
- `src/lib/cockpit-engine.ts` — banded rank score (fresh > stale)
- `/api/cron/gmail-poll-replies` — every 5 min, ingests inbox + classifies
- `/api/cron/inbox-refresh` — nightly + chunked, recomputes states
- `/api/admin/inbox-backfill` — one-shot historical Gmail import

### 1.5 Gmail STAR signal
George stars threads in Gmail. Starred contacts rocket to the top
of the cockpit (+5,000,000 boost) regardless of other heuristics.

**Powered by:**
- `/api/cron/inbox-star-sync` — every 15 min, mirrors Gmail's
  `is:starred` label onto `contacts.inbox_starred`
- `gmail-poll-replies` also propagates STARRED on each new inbound

### 2. Smart Contact Database
Every contact gets multi-tag categorised: `travel_advisor`,
`charter_client`, `b2b_partner`, `press`, `vendor`, `cold_lead`.
Confidence per tag; manual override (UI) is permanent.

**Powered by:**
- `src/lib/pillar2-tagger.ts` — Gemini call with strict JSON output
- `gmail-poll-replies` — auto-tags new contacts within 5 min
- `/api/admin/inbox-tag` — bulk re-tag (chunked, resumable, ?force=1)
- `Pillar2TagEditor` component — chip toggle UI on contact detail page
- `/api/crm/contacts/:id/tags-v2` PUT — manual override
- `/api/crm/contacts/export?tag=...` — CSV scoped by tag

### 3. Relationship Maintenance Engine
Auto-DRAFTS (never sends) culturally-appropriate greetings on
birthdays, name days, and 12 holiday types per contact's inferred
religion + country.

**Powered by:**
- `src/lib/pillar3-holidays.ts` — Easter computus + variable-date table
- `src/lib/pillar3-greek-namedays.ts` — ~120 Greek first names → MM-DD
- `src/lib/pillar3-religion-inferrer.ts` — country + name → religion
- `src/lib/pillar3-greeting-templates.ts` — bilingual templates
- `/api/cron/inbox-greetings` — nightly 03:00 Athens, drafts for tomorrow
- `/api/admin/religion-infer` — one-shot populate `inferred_religion`
- `/api/admin/greetings-smoketest?email=X&keep=1` — pipeline check
- Cockpit "📬 Greetings Ready" surface

---

## Admin operations

| Endpoint | Purpose |
|---|---|
| `/api/admin/inbox-backfill?days=180` | Import Gmail history (chunked via `?pageToken=`) |
| `/api/admin/inbox-debug?email=X` | Inspect one contact's state + Gmail probe |
| `/api/admin/inbox-tag-debug?email=X` | See raw AI tagger response for one contact |
| `/api/admin/inbox-tag` | Bulk re-tag (`?force=1` to ignore 30-day skip) |
| `/api/admin/inbox-cleanup-warmup?apply=1` | Delete cold-email warmup contacts |
| `/api/admin/inbox-cleanup-noise-emails?apply=1` | Delete noise contacts (DMARC/invoices/etc) |
| `/api/admin/inbox-create-contact?email=X&first=Y&last=Z` | Manual contact + Gmail import |
| `/api/admin/religion-infer` | Populate `inferred_religion` |
| `/api/admin/greetings-smoketest?email=X` | End-to-end Pillar 3 verification |

---

## Migrations to apply (Supabase Studio → SQL Editor)

In order, paste each file:
1. `src/lib/inbox-state-migration.sql`
2. `src/lib/inbox-starred-migration.sql`
3. `src/lib/pillar2-tagging-migration.sql`
4. `src/lib/pillar3-greetings-migration.sql`

All migrations are idempotent (`IF NOT EXISTS`).

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
