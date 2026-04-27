# GY Command Center — Operations Manual

_Last updated: v3 (2026-04-27)_

This is the working operator's reference for everything George needs to
run, debug, and extend the system. Pair it with `README.md` (which
covers the why) and `CLAUDE.md` (which covers the conventions Claude
must follow when contributing).

---

## 1 · The 9 Pillars at a glance

| #   | Pillar                       | What it does                                                     | Where it lives                                                                  |
| --- | ---------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Inbox Brain                  | Ranks Gmail threads by who owes a reply / who's gone cold        | `src/lib/inbox-analyzer.ts`, `src/lib/cockpit-engine.ts`                        |
| 1.5 | Gmail STAR boost             | A starred thread always wins ranking                             | Star sync cron `inbox-star-sync` (every 15 min)                                 |
| 2   | Smart Contact DB             | Auto-tags contacts (UHNW, advisor, broker, b2b…)                 | `src/lib/pillar2-tagger.ts`                                                     |
| 3   | Greetings                    | Birthday + name-day + holiday Gmail drafts                       | `src/lib/pillar3-*.ts`, cron `inbox-greetings`                                  |
| 4   | Newsletter & Drip _(v3)_     | Two-stream campaigns + audience builder + per-recipient send     | `src/lib/newsletter.ts`, `/api/admin/newsletter`, `/dashboard/newsletter`       |
| 4-old | Promised Commitments        | Tracks promises George made; surfaces overdue                    | `src/lib/commitment-extractor.ts`, `commitments` table                          |
| 5   | Health Score                 | 0-100 composite per contact; 7 components, nightly recompute     | `src/lib/health-scorer.ts`, cron `health-score-recompute`                       |
| 7   | Charter Lifecycle _(v3)_     | 17 dated milestones from contract → annual anniversary           | `src/lib/charter-lifecycle.ts`, cron `charter-lifecycle-fire`                   |
| 8   | Document-Driven Setup _(v3)_ | Contract → activation cascade (deal + 17 milestones)             | `src/lib/charter-doc-extractor.ts`, `charter-activation.ts`, `/dashboard/charters` |
| 9   | Multi-Guest Network _(v3)_   | Every onboard guest becomes a CRM contact                        | `src/lib/charter-guest-cascade.ts`, `/dashboard/network`                        |

---

## 2 · First-time setup

1. **Apply migrations in Supabase Studio (SQL Editor → New query)**, in
   order:
   - All `src/lib/*-migration.sql` files from prior sprints (already
     applied if Pillars 1-5 are working)
   - `src/lib/v3-charter-engine-migration.sql` — Pillars 7+8+9
   - `src/lib/v3-newsletter-migration.sql` — Pillar 4
   Each file is `IF NOT EXISTS` idempotent — running twice is safe.
2. Verify with `GET /api/admin/qa-smoketest` (or click the button on
   `/dashboard/admin/test`). Every row should be ✅.
3. Confirm env vars on Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `AI_API_KEY`, `AI_MODEL` (defaults to `gemini-2.5-flash`)
   - Gmail OAuth secrets per `src/lib/google-api.ts`
   - `NEXT_PUBLIC_SITE_URL` (used for unsubscribe links —
     defaults to `https://command.georgeyachts.com`)

---

## 3 · Daily operating loop

| Time (Athens) | Cron                            | What happens                                                  |
| ------------- | ------------------------------- | ------------------------------------------------------------- |
| 02:30         | `health-score-recompute`        | Recomputes all contact health scores                          |
| 03:00         | `inbox-greetings`               | Drafts tomorrow's birthday / name-day / holiday emails        |
| 03:30         | `inbox-refresh`                 | Re-analyzes every contact's last meaningful inbound           |
| 04:00         | `cockpit-briefing`              | Pre-builds today's cockpit (so the page loads instantly)      |
| 04:30         | `charter-lifecycle-fire` _(v3)_ | Drafts Gmail messages for today's charter milestones          |
| 05:00         | `commitments-surface`           | Re-classifies open commitments + posts overdue summary        |
| 06:00 Sun     | `health-weekly-digest`          | Weekly health-score Telegram summary                          |
| Every 15 min  | `inbox-star-sync`               | Pulls fresh Gmail stars                                       |

**Auto-actions never auto-send.** Greetings, lifecycle drafts,
commitment nudges all stop at the Gmail draft / Telegram approval
stage. George's hand on the keyboard is the trigger.

---

## 4 · Daily morning routine

1. Open `https://command.georgeyachts.com/dashboard`. The cockpit
   stacks:
   - **⏰ Promises Due** (if any) — overdue commitments first
   - **🛥️ Charter Pipeline** _(v3)_ — today's lifecycle milestones,
     each with a deep-link into the charter workspace
   - **📬 Inbox Brain** — top 25 ranked threads
   - **Pulse** + **Opportunities** + **Devil's advocate**
2. For each Charter Pipeline row with a "draft ready" badge, open
   Gmail (label `gy-charter-lifecycle/<milestone_type>`), review,
   send.
3. For greetings — open Gmail label `gy-greetings`, bulk-review
   tomorrow's drafts.
4. For inbox threads marked **OWED REPLY**, reply or use the AI
   suggestion.

---

## 5 · Activating a new charter

1. **Get the contract text** (PDF → copy; MYBA / private both OK).
2. Go to `/dashboard/charters/new`.
3. Choose **📜 Contract**, paste the text, optionally drop the file in.
4. Click **Extract & process**. If confidence ≥ 0.80 + critical fields
   present → activation cascade fires:
   - The primary contact is created (or matched by email).
   - A row in `deals` is upserted with all extracted fields.
   - The contact's denormalized fields (`charter_vessel`,
     `charter_start_date`, etc.) are mirrored.
   - All **17 lifecycle milestones** are planned and persisted.
5. If confidence is too low → the document lands in
   `/dashboard/charters/review`. Open it, paste corrected text,
   re-run.
6. Upload **passports**, **guest list**, **PIF** the same way. Each
   one cascades:
   - Contacts created (with `network_source = "<vessel>_<month>_<year>_charter"`)
   - `charter_guests` rows linking guest → deal
   - PIF preferences saved on `deals.charter_preferences`

The 17 milestones from `charter-lifecycle.ts`:

| Type             | When                       | Action                                       | Auto-draft? |
| ---------------- | -------------------------- | -------------------------------------------- | ----------- |
| T-60             | 60d before start           | Reference research begins                    | —           |
| T-45             | 45d before start           | Reference list to client                     | ✉️          |
| T-40             | 40d before start           | Trip-prep nudge (PIF + captain call)         | ✉️          |
| T-30             | 30d before start           | PIF + schedule captain call                  | ✉️          |
| T-21             | 21d before start           | (internal) crew brief check                  | —           |
| T-15             | 15d before start           | (internal) provisioning sync                 | —           |
| **T-14**         | 14d before start           | **Personal video from George onboard** ⭐    | ✉️ + 📅     |
| T-7              | 7d before start            | Final logistics summary                      | ✉️          |
| T-3              | 3d before start            | "Looking forward" reassurance                | ✉️          |
| T-1              | 1d before start            | (internal) day-before crew check-in          | —           |
| T+0              | Embarkation day            | Welcome aboard                               | ✉️          |
| T+midpoint       | Halfway through            | Midweek check-in                             | ✉️          |
| T+disembark+1    | 1d after disembark         | Thank-you                                    | ✉️          |
| T+7              | 7d after disembark         | Testimonial ask                              | ✉️          |
| T+30             | 30d after disembark        | "Hope you're well" warm touch                | ✉️          |
| T+90             | 90d after disembark        | Next-season planning seed                    | ✉️          |
| T+annual         | 1yr after disembark        | "One year ago today" — fires per **guest**   | ✉️          |

All templates personalized via `TemplateContext` —
`{client_first_name}`, `{vessel_name}`, `{embark_port}`,
`{captain_name}`, `{region}`.

---

## 6 · Sending a newsletter

1. Go to `/dashboard/newsletter` → **+ New campaign**.
2. Pick a stream:
   - **general** — warm monthly to opted-in clients/prospects
   - **advisor** — peer-to-peer monthly to travel advisors
   - **bespoke** — open template
3. Optionally type a brief; AI drafts subject + body in the requested
   tone.
4. On the campaign page:
   - Tweak subject + body if needed (inline edits are local for v1 —
     use **↻ AI regenerate** to overwrite).
   - Adjust the audience (saved segment OR ad-hoc filters).
   - Click **🔍 Preview audience** to see count + first 25 emails.
   - **✉️ Send test** to yourself (defaults to
     `george@georgeyachts.com`).
   - Once happy, **🚀 Send to N recipients** — confirm prompt → real
     send begins.
5. The send is per-recipient, idempotent (unique on
   `campaign_id, recipient_email`), and time-budgeted to 250s. If the
   audience is large, re-invoke `?action=send` to resume from where
   it left off.
6. Each recipient gets a unique unsubscribe link
   (`/api/newsletter/unsubscribe?token=…`). Clicking it flips
   `contacts.subscribed_to_newsletter = false` and stamps
   `unsubscribed_at` — they drop out of every future audience query.

---

## 7 · Common admin endpoints (curl-friendly)

| Endpoint                                  | Purpose                                                    |
| ----------------------------------------- | ---------------------------------------------------------- |
| `GET /api/admin/qa-smoketest`             | Schema + table sanity check across all 9 pillars           |
| `GET /api/cron/cockpit-briefing`          | Force-rebuild today's cockpit                              |
| `GET /api/cron/inbox-refresh`             | Re-analyze every contact's inbox state                     |
| `GET /api/cron/charter-lifecycle-fire`    | Force-fire today's charter milestones                      |
| `GET /api/admin/inbox-classify?force=1`   | Re-classify every email_inbound activity                   |
| `GET /api/admin/sentiment-backfill`       | Re-cache sentiment per activity (for health score)         |
| `GET /api/admin/health-score-recompute`   | Recompute all contact health scores                        |
| `GET /api/admin/inbox-tag`                | Re-run Pillar 2 tagger across contacts                     |
| `GET /api/admin/charter-extract?status=manual_review` | List documents stuck in manual review              |
| `POST /api/admin/newsletter`              | Create a campaign (see Pillar 4 §6 above)                  |

For long-running operations, every endpoint that can hit the 300s
Vercel timeout returns `next_offset` — re-invoke with `?offset=…` to
resume.

---

## 8 · Troubleshooting

**Cockpit's 🛥️ Charter Pipeline section is empty.** The v3 charter
migration hasn't been applied yet — run
`src/lib/v3-charter-engine-migration.sql` in Supabase Studio. The
section is wrapped in try/catch so it gracefully no-ops; check
`/api/admin/qa-smoketest` for the diagnosis.

**Newsletter dashboard errors with "DB error".** Same root cause for
the newsletter migration — apply
`src/lib/v3-newsletter-migration.sql`.

**A contract extraction lands in manual_review.** Confidence < 0.80
or one of the critical fields (start_date, end_date, vessel_name,
client_full_name, charter_fee_eur, balance_due) is missing. Open
`/dashboard/charters/review`, paste corrected text, re-run.

**Newsletter send seems slow.** It's intentional — per-recipient
Gmail draft + send, never a blast. 250s budget per call; for big
audiences, re-invoke `?action=send` until status flips from `sending`
to `sent`.

**A guest got an unsubscribe link but I want to email them again.**
Their `contacts.subscribed_to_newsletter` is now `false` — for a
direct, non-mass message just send it from Gmail (the unsubscribe
only blocks newsletter mass sends, not 1-on-1 outreach).

**The Pillar 7 cron drafts the wrong template.** Check the
`TEMPLATE_KEY` map in
`src/app/api/cron/charter-lifecycle-fire/route.ts` — it pairs each
`milestone_type` with a template key in `charter-lifecycle.ts`.
Edit either side and redeploy.

**Gemini truncated the AI output mid-JSON.** The extractor strips
markdown fences defensively + matches `{[\s\S]*}` greedily. If
truncation persists, bump `maxTokens` in the relevant
`extractWithAI` / `composeCampaign` call.

---

## 9 · Database tables in one screen

| Table                            | Owner pillar | What it holds                                                |
| -------------------------------- | ------------ | ------------------------------------------------------------ |
| `contacts`                       | 2            | The CRM contact record (+ all v3 enrichment columns)         |
| `tags`, `contact_tags`           | 2            | Pillar 2 auto-tagger output                                  |
| `activities`                     | 1            | Email/call/meeting events; classified per Sprint 2.1         |
| `email_classifications`          | 1            | Per-thread classifier cache                                  |
| `pipeline_stages`                | core         | Hot / Warm / Closed Won, etc.                                |
| `commitments`                    | 4-old        | George's promises (overdue surfacing)                        |
| `health_score_history`           | 5            | Daily health-score time series                               |
| `greeting_drafts`                | 3            | Gmail drafts the greetings cron has staged                   |
| `deals`                          | v3/8         | Normalized charter deal — multiple per contact OK            |
| `charter_documents`              | v3/8         | Uploaded contracts/passports/PIFs + extraction state         |
| `charter_lifecycle_milestones`   | v3/7         | The 17 timed touchpoints per deal                            |
| `charter_guests`                 | v3/9         | Per-charter guest list (deal × contact)                      |
| `newsletter_campaigns`           | v3/4         | The email itself                                             |
| `newsletter_sends`               | v3/4         | One row per recipient (open/click/unsub state)               |
| `audience_segments`              | v3/4         | Reusable audience filter definitions                         |

---

## 10 · Extending the system

**Adding a new milestone type to the charter lifecycle.** Extend
`MilestoneType` in `src/lib/charter-lifecycle.ts`, add a case in
`planMilestones()`, write a template in `TEMPLATES`, add the type to
`TEMPLATE_KEY` in the cron, and let the unique constraint
`uq_milestone_per_deal_type` dedup re-runs.

**Adding a new newsletter stream.** Extend the `Stream` union in
`src/lib/newsletter.ts`, add a `SYSTEM_PROMPTS` entry, add the radio
button in `NewCampaignButton.tsx`. The composer + send flow is
stream-agnostic.

**Adding a new audience filter dimension.** Extend `AudienceFilter`
in `src/lib/newsletter.ts`, add a clause in `resolveAudience()`, add
a UI input in `ComposerClient.tsx`. The same shape works for ad-hoc
filters and saved `audience_segments` rows.

---

_End of manual. When in doubt: read the brief (`README.md`),
read the code (it's small enough — ~30 lib files, ~50 routes), and
ship something._
