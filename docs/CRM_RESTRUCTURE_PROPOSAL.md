# GY Command Center — UX Restructure Proposal
## 2026-04-29 · Authored after George's feedback session

> *"Κάναμε εκπληκτική δουλειά στο newsletter — αυτό το χρησιμοποιώ
> και άνετα. Όλα τα άλλα νομίζω ότι είναι λίγο μπακ λίγο παντού
> βαλμένα και δε με βολεύει. Θα μπορούσαμε και τις άλλες τεχνολογίες
> που έχουμε βάλει μέσα σε αυτή την εφαρμογή μας να είναι ξεχωριστά
> σαν το newsletter."*

This is a written proposal — no code yet. George reads, picks
priorities, then we execute one section at a time at newsletter
quality.

---

## 1. Why the Newsletter section works (the template)

Four tabs, one job each:

```
Subscribers │ Issues │ Composer │ Queues
```

Each tab has a single purpose — add a contact, prepare an issue,
write content, queue future signals. No overlap, no decision
fatigue, no "where do I click for X". George opens the tab he
needs and stays inside it until the job is done.

**This is the model.** Every other section should follow it.

---

## 2. Current sprawl — honest assessment

The dashboard has **14 nav entries** plus **4 quick-action
shortcuts** in the header bar plus **16 dashboard widgets**:

| Nav | Widgets visible from /dashboard |
|---|---|
| Dashboard | ClientIntel, ContentPipeline, Currency, Cockpit, FollowUp, Intel, Marine, Outreach, PageSpeed, Partnership, Security, Sitemap, Weather, WorldClock |
| Contacts, Email, Newsletter, Calendar, Chat, Outreach, Visitors, Revenue, Fleet, Analytics, Brand Radar, Instagram, Command | each its own page |

**The pain points:**

1. **Dashboard widgets compete for attention.** 14+ widgets stacked
   on one page = nothing is the priority.
2. **Naming overlap.** "Outreach" (nav) vs "OutreachBotWidget"
   (dashboard widget) vs "Cold mail Apps Script" (separate system)
   — same word, three referents.
3. **Some tools are info-only, others are operate-from.** No
   visual distinction. George can't tell at a glance which page
   does work vs which page just shows numbers.
4. **No grouping.** Calendar + Chat + Email belong together
   (communications). Fleet + Charters + Newsletter belong together
   (revenue ops). Currently they're all flat siblings.

---

## 3. Proposed information architecture — 5 buckets

Top-level nav reduces from 14 to 5 buckets. Each bucket has 2-4
sub-tabs inside, like the newsletter section's pattern.

```
🗂  OPERATE   — daily revenue work (newsletter, charters, outreach, email)
📊  GROW      — content + audience tools (instagram, brand radar, blog, social)
🤝  CONTACTS  — single contact directory (replaces contacts + visitors + intel)
📈  ANALYTICS — revenue, web stats, social analytics, system health
⚙️  CONFIG    — env, integrations, AI personas, cron schedules
```

Quick-action shortcuts in the header reduce to **3** that always
matter: New Lead · Quick Compose · Today's Pings.

---

## 4. Per-section deep dive

For each section: **purpose · what works · what's broken · proposal
· revenue impact**.

---

### 🗂 OPERATE — Daily revenue work

#### 4.1 Newsletter ✅ KEEP AS-IS
Already at the standard we're aiming for. No changes.

#### 4.2 Charters
**Purpose:** Track every active and upcoming charter. The booking
funnel from inquiry → confirmed → mid-charter → post-charter.

**What works:** Charter lifecycle states are wired into Supabase
(charter-lifecycle.ts is solid). Whisperer cron (charter-whispers)
sends pre-charter prep reminders. Post-charter cron handles
debrief flow.

**What's broken:** No clean dashboard view that shows "all charters
this season at a glance". Tabs are scattered across `/dashboard/
charters` page sections. The status pipeline isn't visualised.

**Proposal:** Three tabs.
- `Pipeline` — funnel view (inquiry / confirmed / mid-charter /
  closed) with one-click status transition
- `Active` — every charter currently sailing or about to embark,
  with countdown to embarkation and crew contact
- `Post-charter` — debrief, testimonial requests, follow-up nudges

**Revenue impact:** High. This is where deals close or slip. A
clean pipeline view = no charter falls through cracks.

#### 4.3 Outreach (cold mail + IG engagement)
**Purpose:** Find new advisors / partners / clients via cold mail
+ IG comment relationship building.

**What works:** Apps Script bots fire daily, dedup is solid,
cross-bot guard prevents George + Eleanna duplicate-pitching.
Daily IG engagement digest is the right idea (15 targets/day from
pool of 45 with rotation).

**What's broken:**
- Dashboard "Outreach" page exists but doesn't expose the bot's
  state (last fire, daily quota used, recent replies, prospects
  pipeline). George has to read Telegram to know what happened.
- No queue UI for adding new prospects to the spreadsheet —
  currently he edits Google Sheets directly.

**Proposal:** Three tabs.
- `Status` — bot dashboard: last successful fire, sent today /
  daily limit, replies pending, recent suppressed
- `Prospects` — read view of the spreadsheet with search + status
  filter; "add prospect" button writes to the sheet via API
- `Replies` — Gmail thread previews from people who replied; one-
  click "draft personal response" via AI

**Revenue impact:** Medium-high. Outreach IS a major lead source.
Better visibility = more replies followed up.

#### 4.4 Email (inbox triage)
**Purpose:** Triage incoming george@ inbox without leaving the CRM.

**What works:** Inbox sync, classification (charter / partnership /
spam), starring.

**What's broken:** The page feels like a Gmail clone with less
features than Gmail. George defaults back to Gmail.

**Proposal:** Repurpose entirely. New focus: **AI inbox brief**.
Three tabs.
- `Today's brief` — AI-summarised: 3 hot threads needing reply, 5
  warm follow-ups, count of cold/spam ignored. Single decision
  per thread (reply now / draft / snooze / archive).
- `Drafts` — AI-suggested replies, awaiting one-tap send
- `Threads requiring me` — explicit @mentions, reply chains where
  George is the bottleneck

**Revenue impact:** High. UHNW clients reply matters in hours, not
days. Inbox triage that surfaces priorities = no client lost to
slow reply.

---

### 📊 GROW — Audience + content

#### 4.5 Instagram
**Purpose:** Run the IG account end-to-end (publish, engage, monitor).

**What works:** A LOT. 30+ IG-related crons. Auto-publish, watchdog,
engagement digest, follow-up DMs, story mentions, weekly reports.
This is the most-built-out part of the system.

**What's broken:**
- Settings scattered across env vars and Supabase settings table
- No one place to see "this week's IG operating state"
- The 5/day DM cap (`ig-engagement-dm`) often surfaces 0-3 — needs
  better source candidate pool

**Proposal:** Four tabs.
- `Operate` — today's queue, scheduled posts next 7 days, draft
  approvals pending
- `Engagement` — DM digest, comment digest, follower trends
- `Performance` — analytics from `instagram-monthly-report`
  surfaced live
- `Settings` — auto-publish flag, daily DM cap, target pool editor

**Revenue impact:** Medium. IG is brand-building, slower funnel
than direct outreach but protective long-term.

#### 4.6 Brand Radar
**Purpose:** Track which AI assistants (ChatGPT, Perplexity, etc.)
mention George Yachts and how often.

**What works:** brand-radar-queries.ts pulls data from Ahrefs MCP.
Recents are fresh.

**What's broken:** Not promoted. George rarely opens it because
it's buried in the nav and the page feels static.

**Proposal:** Two tabs.
- `Mentions` — list of recent AI mentions, sortable, with full
  conversation context
- `Trend` — share of voice over time vs competitors

**Revenue impact:** Low-medium today, high in 2-3 years as AI
assistants displace Google for "find me a yacht broker in Greece".

---

### 🤝 CONTACTS — Unified contact directory

#### 4.7 Contacts (replaces Contacts + Visitors + ClientIntelWidget)
**Purpose:** Single source of truth for everyone in our orbit —
prospects, clients, advisors, peers, vendors.

**What works:** Contacts page exists, contact-type-migration.sql
defines categories.

**What's broken:**
- "Visitors" is a separate top-level nav but it's just contacts
  who visited the site. Should be a filter, not a separate tab.
- ClientIntelWidget on the dashboard duplicates info also visible
  on the Contacts page.

**Proposal:** ONE Contacts section, four tabs.
- `Directory` — searchable list with filters (type, recent visit,
  newsletter stream, etc.)
- `Hot leads` — filtered subset: high-intent contacts (recent
  proposal request, multiple opens, replied recently)
- `Today's outreach` — who to contact today (AI-prioritised)
- `Activity feed` — visitor pings, opens, replies, follow-back
  events in one timeline

Eliminates: separate Visitors nav, ClientIntelWidget, FollowUpWidget.

**Revenue impact:** High. Right contact at right time = closed deal.

---

### 📈 ANALYTICS

#### 4.8 Analytics + Revenue + System Health
**Proposal:** Merge into one section, three tabs.
- `Revenue` — booked, projected, by stream (private fleet vs
  explorer vs partnerships)
- `Web` — sessions, top pages, conversion (from existing analytics
  page)
- `System Health` — daily check results (NEW today, runs 10:05
  Athens), deliverability stats, cron failures, token expiry
  countdowns. The 13 checks from system-health-check cron surfaced
  as a dashboard live view.

Eliminates: separate Analytics + Revenue + Visitors nav (visitors
moves to Contacts → Activity feed).

**Revenue impact:** Visibility — without numbers George can't
double-down on what works.

---

### ⚙️ CONFIG — Operator-only

#### 4.9 Config
**Purpose:** Things that change once a quarter, not daily.

Tabs:
- `Integrations` — IG / Facebook / TikTok / LinkedIn token status,
  reauth buttons, webhook URLs
- `Crons` — list of all 53 crons, last run, success rate, next
  scheduled. Manual trigger button per cron (auth-gated).
- `AI Personas` — system prompts for the 4 AI flows (DM classify,
  body assemble, brand radar, comment generator). Edit as YAML.
- `Cadence rules` — newsletter cadence + auto-mode toggles, IG
  daily caps, outreach daily caps, all in one place.

This replaces "Command" nav (which was vague) and unburies the
configuration that's currently in scattered env vars.

**Revenue impact:** Low directly, but reduces operator confusion
and makes future hires onboardable.

---

### Quick-action shortcuts (header)

Reduce from current 4 to 3 that always matter:
- ⚡ **Today's pings** — all alerts from last 24h in one panel
- ✍️ **Quick compose** — opens the right composer based on context
  (newsletter / cold mail / IG comment / inbox reply)
- 🆕 **New lead** — fast contact creation form

---

## 5. Recommended priority

Phased rollout — don't refactor everything at once.

### Phase 1 (week 1) — "Stop the bleeding" clean-ups
- ✅ DONE today: newsletter counter fix, IG digest rotation, daily-
  limit dedup, name attribution, system health check
- Remove unused dashboard widgets that clearly don't drive decisions
- Rename "Visitors" → "Recent visitors" (or fold into Contacts)

### Phase 2 (week 2) — Contacts unification
- Build the unified Contacts section with 4 tabs as proposed
- Migrate ClientIntelWidget + FollowUpWidget content into the
  Activity feed tab
- Add the "Hot leads" filter view

### Phase 3 (week 3) — Outreach dashboard
- Status / Prospects / Replies tabs
- Live state from the Apps Script bots (new `/api/outreach/state`
  endpoint that reads PropertiesService via a small auth)
- "Add prospect" form that writes to the spreadsheet

### Phase 4 (week 4) — Charters pipeline
- Pipeline / Active / Post-charter tabs
- Funnel visualisation
- Status transition buttons with audit trail

### Phase 5 (week 5) — IG section restructure
- Operate / Engagement / Performance / Settings tabs
- Surface settings table values as editable
- Target pool editor (replaces hard-coded ALL_TARGETS)

### Phase 6 (week 6+) — Email triage rethink
- AI inbox brief
- Drafts / Threads requiring me
- Larger refactor — saves last because Gmail is acceptable as
  fallback while we iterate

### Phase 7 — Brand Radar polish + Analytics merge + Config
- Last because lower-frequency use

---

## 6. Per George's criteria — "free, brings money, quality"

| Section | Free? | Brings money? | Quality bar |
|---|---|---|---|
| Newsletter | ✓ Free tier infra | ✓ High — 80→1000 subscribers = 4-7% reply rate | Already at quality bar |
| Charters | ✓ Supabase free tier | ✓ Direct revenue tracking | Pipeline view needed |
| Outreach | ✓ Free Apps Script + Gmail | ✓ Highest — direct lead gen | Status visibility weak |
| Email | ✓ Gmail | Indirect (lost-deal cost) | Currently below bar |
| Instagram | ✓ Meta Free tier | Brand-build, slow funnel | Most built-out, settings UX weak |
| Brand Radar | Ahrefs MCP (paid) | Strategic 2-3 yr horizon | Underused but solid data |
| Contacts | ✓ Supabase free tier | ✓ Right-time-right-person | Fragmented across 3 widgets |
| Analytics | ✓ Vercel + GA free | Visibility = decisions | OK but isolated |
| Config | ✓ Vercel env free | Operator efficiency | Doesn't exist yet |

---

## 7. What NOT to change

- **Newsletter.** Touch nothing. It works.
- **Approval gate pattern.** Telegram URL inline buttons stay as the
  guard rail across every section.
- **Apps Script bots' core logic.** Cold mail dedup, cross-bot
  guard, daily caps — keep all of it. Just surface state in the CRM.
- **53 crons.** Rename / rearrange UI but keep the existing
  schedules and observability.

---

## 8. Action for George

Read this. Pick the **first phase you want me to do**. Tell me:

1. Phase number (1-7) — which is most painful right now
2. Anything in the proposal I got wrong about your workflow
3. Anything I missed entirely

Then we work that section to the same standard as Newsletter.
No multi-section sprints. One at a time, full quality.

— Claude · 2026-04-29
