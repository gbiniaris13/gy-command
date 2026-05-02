# gy-command — Data Model

> **Purpose:** Single source of truth for every Supabase table + every
> `settings`-table KV key. Read this before grepping for a column name.
> Sibling docs: ARCHITECTURE.md (subsystems), PLAYBOOKS.md (runbooks).
>
> **Newsletter:** schema rows for `newsletter_*` are listed for
> completeness only. Never modify newsletter behaviour from this repo
> — the public site owns it.

---

## Postgres tables

### `contacts` *(core; implied — no dedicated migration)*
The hub. Every interaction roots here.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `email`, `phone`, `first_name`, `last_name` | text | |
| `source` | text | `outreach_bot`, `inbound_email`, etc. |
| `pipeline_stage` / `pipeline_stage_id` | text / fk | `Hot/Warm/Negotiation/Proposal Sent/Meeting Booked/Contract Sent/Closed Won/Closed Lost/Cold` |
| `charter_vessel`, `charter_start_date`, `charter_end_date`, `charter_fee` | text / date / date / numeric | denormalised "primary deal" snapshot — see Architecture §3 gotcha |
| `payment_status` | text | `pending` / `partial` / `paid` |
| `last_activity_at` | timestamptz | drives staleness everywhere |
| `inbox_starred` | bool | Gmail STAR mirrored every 15min |
| `inbox_last_inbound_at`, `inbox_last_outbound_at`, `inbox_analyzed_at` | timestamptz | maintained by `inbox-analyzer` |
| `health_score`, `health_trend` | int / text | written by health-scorer recompute |
| `next_touch_suggestion`, `next_touch_suggestion_at` | text / timestamptz | AI-cached; only regenerate on state change |
| `subscribed_to_newsletter` | bool | read-only from gy-command |
| `nationality`, `date_of_birth`, `religion` | text / date / text | drives greetings + cultural flags |
| `contact_type` | text | `GUEST_NETWORK`, etc. (from `contact-type-migration.sql`) |

**Writers:** every cron + dashboard mutation surface.
**Readers:** literally every subsystem — this is the hub.

### `activities` *(append-mostly history)*
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `contact_id` | fk → contacts | |
| `type` | text | `email_inbound`, `email_outbound`, `note`, `call`, `meeting`, etc. CHECK constraint **dropped** in `inbox-state-migration.sql` — add to set, don't reintroduce. |
| `created_at` | timestamptz | |
| `description` | text | |
| `metadata` | jsonb | |
| `message_class` | text | `awaits_reply / informational / closing / declined / parked / auto_response / reaction / unknown` |
| `sentiment_warmth`, `sentiment_engagement`, `sentiment_intent` | text | AI-cached so nightly recompute doesn't re-pay |
| `thread_id` | text | Gmail thread id |

**Writers:** `gmail-poll-replies`, `inbox-analyzer`, `auto-reply`,
seed scripts (`crm/seed-*`).
**Readers:** `cockpit-engine`, `health-scorer`, `inbox-analyzer`,
`commitments-surface`, `pillar2-tagger`.

### `pipeline_stages`
| Column | Notes |
|---|---|
| `id`, `name`, `position`, `color` | small reference table; `name` is the canonical lookup |

### `deals` *(from `v3-charter-engine-migration.sql:24`)*
| Column | Notes |
|---|---|
| `id`, `primary_contact_id` | |
| `vessel_name`, `charter_start_date`, `charter_end_date`, `charter_fee_eur` | |
| `payment_status` | `pending / partial / paid` |
| `lifecycle_status` | `pre / active / post / archived` |
| `lifecycle_activated_at` | when the 17-milestone fire-cron took ownership |

**Writers:** `charter-activation`, `charter-lifecycle-fire`, dashboard
charters detail page.
**Readers:** `cockpit-engine`, `command-center-snapshot`,
`charter-lifecycle-fire`.

### `charter_documents` *(`v3-charter-engine-migration.sql:59`)*
| Column | Notes |
|---|---|
| `id`, `deal_id`, `contact_id` | |
| `document_type` | e.g. `client_brief`, `mva`, `manifest` |
| `file_path` | Supabase Storage path |
| `extraction_status` | `pending / extracted / failed` |
| `extracted_data` | jsonb |
| `extraction_confidence` | numeric |

**Writers:** `charter-doc-extractor`, manual upload UI.
**Readers:** `charter-lifecycle-fire` (gates milestones on doc availability).

### `charter_guests` *(`v3-charter-engine-migration.sql:90`)*
| Column | Notes |
|---|---|
| `id`, `deal_id`, `contact_id` | |
| `role` | `principal / family / friend / advisor` |
| `linked_via` | how we discovered them |
| `emails_with_george_count` | post-charter touchpoint signal |
| `post_charter_status` | drives T+annual cascade |

### `charter_lifecycle_milestones` *(`v3-charter-engine-migration.sql:128`)*
| Column | Notes |
|---|---|
| `id`, `deal_id`, `milestone_type`, `due_date`, `status` | |
| `auto_action` | what the fire-cron will draft |
| `gmail_draft_id` | non-null once a draft is sitting in Gmail |
| `completed_at` | manual mark-complete by George |

### `commitments` *(`v2-commitments-migration.sql:15`)*
| Column | Notes |
|---|---|
| `id`, `contact_id`, `thread_id`, `source_message_id` | |
| `commitment_text`, `commitment_summary` | |
| `deadline_date`, `deadline_phrase` | |
| `fulfilled_at`, `dismissed_at` | both null = open |
| `source_sent_at` | the outbound that made the promise |

**Index:** `(deadline_date) WHERE fulfilled_at IS NULL AND dismissed_at IS NULL` — efficient open-item walk.
**Writers:** outbound send flow extractor, `commitments-backfill`.
**Readers:** `commitments-surface` cron, `cockpit-engine`.

### `email_classifications` *(`v2-message-class-migration.sql`)*
| Column | Notes |
|---|---|
| `id`, `contact_id`, `thread_id` | |
| `classification` | one of the 8 classes (see ARCHITECTURE.md §2) |
| `confidence`, `context` | |

### `health_score_history` *(`v2-health-score-migration.sql`)*
| Column | Notes |
|---|---|
| `id`, `contact_id`, `score_total` | |
| `recency`, `sentiment`, `reply_rate`, `deal_velocity`, `commitment_penalty`, `greetings_bonus` | per-component breakdown |
| `trend` | `up / down / flat` vs previous run |
| `created_at` | one row per contact per recompute |

### Instagram tables

| Table | Migration | Notes |
|---|---|---|
| `ig_posts` | `ig-posts-metadata-migration.sql` | `status: pending_approval / scheduled / published / draft`. Approval gate flips status; publish cron reads `scheduled`. |
| `ig_post_analytics` | `ig-post-analytics-migration.sql` | per-post engagement metrics; `instagram-analytics` cron writes |
| `ig_competitors` | `ig-competitors-migration.sql` | follower counts of tracked accounts |
| `ig_dm_replies` | `ig-dm-replies-migration.sql` | inbound DMs; AI-routed by `ig-engagement-dm` cron |

### Brand Radar

| Table | Migration | Notes |
|---|---|---|
| `brand_radar_scans` | `brand-radar-migration.sql:4` | per-query result rows |
| `brand_radar_weekly` | `brand-radar-migration.sql:23` | aggregated SoV summary |

### Other

| Table | Migration | Notes |
|---|---|---|
| `calendar_events` | implied (from `calendar-sync/route.ts`) | mirrored Google Calendar |
| `linkedin_actions` | `linkedin-actions-migration.sql` | like / comment / share log |
| `newsletter_campaigns` | (newsletter migration in public site) | **read-only here** |
| `newsletter_sends` | (same) | **read-only here** |
| `facebook_mirror_*` | `facebook-mirror-migration.sql` | mirror of IG content |
| `after_sales_*` | `after-sales-migration.sql` | post-charter follow-up tracking |

---

## `settings` table — KV-style state

The `settings` table is a generic `(key text PK, value text/jsonb,
updated_at timestamptz)` store. It carries config flags AND
ephemeral state. Treat it as the project's poor-man's Redis.

### Config flags (set manually)
| Key | Type | Used by |
|---|---|---|
| `caption_auto_approve` | `'true'/'false'` string | IG approval gate (`caption-approval-gate.ts`) |
| `gmail_refresh_token` | text | calendar + email subsystems |
| `gmail_connected` | `'true'/'false'` | middleware redirect logic |

### Daily snapshots
| Key pattern | Producer | Consumer |
|---|---|---|
| `cockpit_briefing_<YYYY-MM-DD>` | `/api/cron/cockpit-briefing` (04:00 UTC) | `/dashboard` page, command-center snapshot, Telegram `/status` |
| `outreach_stats:george`, `outreach_stats:elleanna` (legacy: `outreach_stats`) | `/api/sync` POST from Apps Script bots | dashboard outreach page |

### Cron observer instrumentation (auto-pruned 21d)
| Key pattern | Producer | Consumer |
|---|---|---|
| `cron_start_<runId>` | every `observeCron()`-wrapped handler at start | weekly ops report |
| `cron_end_<runId>` | same handler at end | weekly ops report computes success/error/timeout |

---

## Vercel KV keys (read-only from gy-command)

gy-command does **not** use Vercel KV directly — it uses the `settings`
table as its KV. However the public-site repo stores newsletter
subscriber data in Vercel KV, and gy-command reads it via
`NEWSLETTER_PROXY_SECRET` through the proxy at
[src/lib/newsletter-proxy.ts](src/lib/newsletter-proxy.ts).

Cross-repo KV map: see `george-yachts/SHARED_INTEGRATIONS.md` (Tier 4b)
for the full pattern catalogue. Do not document the keys here — they
change with the public site, not with this repo.

---

## Index quick-reference

Useful indexes referenced inline above:

| Index | Table | Predicate |
|---|---|---|
| open-commitments | `commitments` | `(deadline_date) WHERE fulfilled_at IS NULL AND dismissed_at IS NULL` |
| stale-warm fast lookup | `contacts` | `(last_activity_at)` (implied; verify before relying on it) |

---

## How to add a new table

1. Create `src/lib/<feature>-migration.sql` — idempotent
   (`CREATE TABLE IF NOT EXISTS …`).
2. Apply via Supabase SQL Editor by hand. There is no automated runner.
3. Add a row to the table catalogue above (this file).
4. Wire the writer + readers; cite both sets in this file.
5. If it's a hot table, add a pagination loop pattern reference
   (see ARCHITECTURE.md "Cross-cutting concerns").
