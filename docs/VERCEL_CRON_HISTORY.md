# Vercel cron schedule history

**Lesson learned 2026-05-05:** Vercel's `vercel.json` schema is **strict** —
any top-level key that is NOT one of the documented Vercel schema
properties (`crons`, `redirects`, `rewrites`, `headers`, `cleanUrls`,
`trailingSlash`, `regions`, `framework`, `buildCommand`, …) causes
the deployment to fail at config validation **with zero build logs**.

The `_note_*` and `_emergency_note` underscore-comment fields we'd
been adding to vercel.json since 2026-05-03 silently broke every
production deploy. Production was running the old 6fc2e053 build
from 2026-05-02 for 48+ hours without us realising — IG/FB
activation code was committed but never deployed.

**Rule:** never add free-form comment fields to `vercel.json`.
Document changes in markdown here instead.

---

## 2026-10-03 — the charter timeline and ONE morning email (George)

- `/api/cron/charter-timeline` — NEW, `40 4 * * *` (07:40 Athens). For every
  won, direct, non-white-label charter: T-45 (balance, VAT, APA), T-7 (the week
  before, plus the embarkation and a captain-call reminder in George's
  calendar), T-1 (see you at the dock), T+3 (thank you, review, photo). Every
  client letter is a Gmail DRAFT in the client's thread; George presses Send.
  State in extraction.timeline; shares the thank-you guard with
  rebooking-ritual (cabin_thanks_<id>). `?dry=1` previews.
- `/api/cron/morning-brief` — NEW, `20 5 * * *` (08:20 Athens). The one morning
  email "Σήμερα στην Αθήνα": timeline, Helm (opens, holds, follow-ups due, new
  requests), papers, Week editions, the Lighthouse page, the newsletter note.
  Reads the engines' `*_latest` snapshots. `?preview=1` renders the HTML.
- `lighthouse-daily` and `week-edition` no longer send their own emails while
  settings `morning_brief_enabled` is not "0"; their content rides in the brief.
- Calendar write scope added to both consent lists; George presses "Connect
  Gmail" once so the timeline can write his calendar.
- `/api/cron/inbox-documents` — NEW, `*/30 * * * *`. GY Inbox: attachments on
  Gmail messages from a won client's own address, or forwarded by George with
  "GY INBOX" in the subject, are read (what + whose), filed under the charter
  (private bucket + Drive mirror) and the message labelled gy-filed. Unsure
  papers wait at /dashboard/helm/inbox (drop zone there too). `?dry=1`.
- `/api/cron/desk-note-draft` — NEW, `10 5 * * 1` (Mondays 08:10 Athens). The
  Bridge desk note drafted from the Helm's numbers, parked for one-click
  approval in the morning brief (/api/newsletter/desk-note/approve, signed).

## 2026-10-02 — the Week edition reaches the client by itself (George)

- `/api/cron/week-edition` — NEW, `0 5 * * *` (08:00 Athens). For every won
  direct-client charter whose Cabin brief is complete and not yet dispatched,
  writes the client's "Your week, as it stands" email with their edition link
  as a Gmail DRAFT (settings `week_edition_mode` = draft, default) or sends it
  (= send). George is emailed either way. `?dry=1` lists candidates.

## 2026-09-30 — the grid shows the yachts (George)

- `/api/cron/instagram-fleet-post` — `0 15 * * 2,3,4,5` (was `1,2,3,4`;
  the guard allowed Tue/Wed/Thu only, so Monday never fired). Friday is a
  yacht carousel now. Every carousel opens with classified exterior
  photographs (src/lib/ig-shots.ts); fleet_posts_enabled was found OFF
  since 14/9 and switched back on.
- `/api/cron/instagram-publish-reel` — REMOVED from the schedule. The reel
  pool is April stock footage of boats that are not ours; the house rule
  is no placeholder yachts. Route kept; reschedule when real footage of
  the fleet exists.
- `/api/cron/instagram-publish` unchanged (15:30 UTC daily); Mon/Sat rows
  now take an exterior of one of our yachts, named in the caption, page
  in the first comment.

## 2026-05-04 — IG content posting re-enabled

George got IG access back (password changed 2026-05-03). Re-enabled
CONTENT-POSTING crons only:

**ON:**
- `/api/cron/instagram-publish` — main feed posts (15:05 UTC daily)
- `/api/cron/instagram-publish-reel` — reels (Wed/Fri 15:15)
- `/api/cron/instagram-stories` — stories (3×/day @ 5/10/17 UTC)
- `/api/cron/instagram-carousel` — carousels (Mon/Thu 16:00)
- `/api/cron/instagram-fleet-post` — yacht-themed posts (Tue/Wed/Thu 15:30)
- `/api/cron/instagram-fleet-story-followup` — fleet stories (every 3h)
- `/api/cron/instagram-evergreen` — monthly evergreen
- `/api/cron/instagram-generate-weekly` — Sunday batch
- `/api/cron/instagram-health-check` — Mon 7:00 (token monitor)
- `/api/cron/instagram-watchdog` — daily 6:30
- `/api/cron/instagram-analytics` — every 6h
- `/api/cron/instagram-followers` — daily 3:11
- `/api/cron/instagram-monthly-report` — 1st of month 8:00
- `/api/cron/instagram-weekly-ops-report` — Thu 7:00
- `/api/cron/facebook-mirror` — daily 15:35
- `/api/cron/tiktok-mirror` — Mon-Fri 15:15

**OFF (kept off per ban-recovery caution):**
- `instagram-engagement-digest`
- `instagram-dm-followup`
- `ig-engagement-dm`
- All `linkedin-*` crons

**Token migration:** `IG_ACCESS_TOKEN` was killed by the password
reset (Meta auto-invalidates user-OAuth tokens on password change).
Switched to `FB_PAGE_ACCESS_TOKEN` (System User token, never expires,
survives password resets) — see commit `ea1dab2`.

**First-thing-after-deploy verification:** hit
`/api/cron/instagram-health-check` to confirm the Graph API token
is alive. If it 4xx's, refresh via Facebook Business Manager and
update `IG_ACCESS_TOKEN` in Vercel env vars.

---

## 2026-05-03 — EMERGENCY: all social automation paused

George flagged IG account got actioned by Meta — IG-DM session
killed mid-run, account no longer authenticated. Pulled out of
vercel.json every cron that touches a social platform.

Saved original config as `vercel.json.before-emergency-pause-2026-05-03`
(untracked, in repo root) for reference.

Recovered 2026-05-04 (above).
