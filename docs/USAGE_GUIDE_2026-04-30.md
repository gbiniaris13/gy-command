# GY Command — Usage Guide (2026-04-30)

Πώς να χρησιμοποιείς κάθε εργαλείο μετά το Phase 3 restructure.

Όλα ζουν στο `https://command.georgeyachts.com`. Το sidebar τώρα έχει
**5 buckets** με Dashboard στην κορυφή ως home.

---

## 🏠 Dashboard

`/dashboard` — daily cockpit. Μην το ξεχάσεις: **εδώ ξεκινάς κάθε
πρωί**. Διαβάζεις το cockpit briefing που ήρθε στις 04:00 UTC στο
Telegram, και μετά εδώ κάνεις deep-dive σε ό,τι ξεχωρίζει.

---

## 🗂 OPERATE — Daily revenue work

### Newsletter `/dashboard/newsletter`
**Τι κάνει:** Όλο το newsletter system (4 streams: Bridge / Wake /
Compass / Greece). Subscribers, issues, composer, queues σε 4 tabs.

**Χρήση:**
- **Subscribers tab** — βλέπεις counts + per-stream split (Bridge /
  Wake / Compass / Greece). Bulk-add textarea για νέους.
- **Issues tab** — historic issues, open rates, unsubscribes.
- **Composer tab** — 5 templates locked (announce / offer / story /
  intel / blog). Επίλεξε template, γράψε content, στέλνεται για
  Telegram approval prima.
- **Queues tab** — Wake (μηνιαίο 15οs) και Compass (διμηνιαίο 1ηs)
  intel signals. Πρόσθεσες σήμα εδώ → ο cron το παίρνει αυτόματα.

### Email `/dashboard/email`
**Τι κάνει:** Inbox triage με swipe. Κάθε email classified
(HOT/WARM/COLD/NEUTRAL/NOISE/WARMUP) από το `gmail-poll-replies`
cron κάθε 5 λεπτά.

**Χρήση:** Ανοίγεις την σελίδα → swipe για approve / reject draft
reply → επόμενο. Mobile-first.

### Calendar `/dashboard/calendar`
**Τι κάνει:** Google Calendar events live (μέσω `calendar-sync` κάθε
30 min). Pre-call brief stamp δίπλα σε κάθε event.

### Chat `/dashboard/chat`
**Τι κάνει:** AI assistant (Gemini) με access σε όλο το CRM context.
Ρώτα "ποια είναι τα 5 hottest leads μου τώρα;" κι απαντά με real
data.

### Charters `/dashboard/charters` ⭐ NEW στο sidebar
**Τι κάνει:** 3 tabs για όλο το charter pipeline.

**Χρήση:**
- **Pipeline tab** — group by lifecycle status (Inquiry / Confirmed
  / In progress / Completed). Default view, bird's-eye.
- **Active tab** — charter που είτε σαλπάρει τώρα, είτε embarks σε
  ≤30 days. Κάθε row έχει countdown ("⏳ embarks in 5 days").
  **Αυτό κοιτάς πρωί-πρωί** για να ξέρεις τι hands-on δουλειά υπάρχει.
- **Post-charter tab** — disembarked στις τελευταίες 90 days.
  Suggested actions: testimonial request · debrief · 6-month
  rebooking nudge.

### Outreach `/dashboard/outreach` ⭐ Restructured
**Τι κάνει:** Cold mail + IG engagement DM operations. 3 tabs.

**Χρήση:**
- **Status tab** — header alerts (No more leads / Running low /
  Waiting for sync) + per-bot snapshot cards (George + Elleanna
  side-by-side, με live/stale pills) + 6 KPI tiles + pipeline
  breakdown bars + recent activity feed.
- **Prospects tab** — top 200 prospects με stage filter chips
  (All / New / Contacted / Warm / Hot / Won / Lost). Click name →
  contact detail page.
- **Replies tab** — recent 40 inbound replies. Click row → ανοίγει
  το thread στον contact.

> ⚠️ **Action για να δεις τα per-bot cards:**
> Άνοιξε το `docs/PER_BOT_STATS_PASTE.md`, paste το `syncStatsToCommand_()`
> snippet στα `v3.gs` + `elleanna.gs` Apps Script files. Set το
> `SYNC_SECRET` env var. Πιο αναλυτικά εκεί. ~5 λεπτά δουλειά.

---

## 📊 GROW — Audience + content

### Instagram `/dashboard/instagram` ⭐ Restructured
**Τι κάνει:** 4 tabs.

**Χρήση:**
- **Operate tab** — Νέο post (compose) + scheduled queue + recently
  published feed. Default tab — **εδώ δουλεύεις καθημερινά**.
- **Engagement tab** — Competitor watch. Τι κάνουν αυτή τη βδομάδα οι
  άλλοι yachting accounts. Daily snapshot at 03:23 UTC.
- **Performance tab** — Post performance + best time to post +
  follower growth sparkline. Athens-evening peak slot insight.
- **Settings tab** — Documentation. IG token expiry check, auto-
  publish gates (stock-photo guard, caption similarity, reel auto-
  publish flag), engagement DM cadence (cap=10, signal sources).

### Brand Radar `/dashboard/brand-radar`
**Τι κάνει:** Weekly Gemini SoV scan. Πόσες φορές μας αναφέρει το AI
σε relevant queries vs competitors. Cron Sundays 06:00 UTC.

**Χρήση:** Άνοιξε για να δεις το weekly headline (`SoV: X%`,
`top competitor: Y`). Telegram digest πάντα Sunday 06:00 UTC.

### Fleet `/dashboard/fleet`
**Τι κάνει:** Yacht inventory από Sanity CMS (project `ecqr94ey`).
Πόσοι yachts > 6 photos (eligible for carousel posts). Read-only —
edits γίνονται στο Sanity Studio.

---

## 🤝 CONTACTS — Directory

### Contacts `/dashboard/contacts`
**Τι κάνει:** Όλη η CRM database. Search + filter + click → detail
page (timeline, deals, draft replies).

### Visitors `/dashboard/visitors` _(parked)_
**Status:** Hidden mobile, visible desktop. Real-time visitor pings
από το public site. Παρκαρισμένο μέχρι να ξανα-σταθεροποιηθεί η ροή.

---

## 📈 ANALYTICS

### Analytics `/dashboard/analytics`
**Τι κάνει:** GA4 + GSC + site metrics in one view.

### Revenue `/dashboard/revenue`
**Τι κάνει:** Pipeline value, commission upside, deal stages. Πιο
"money-focused" view του Charters pipeline.

---

## ⚙️ CONFIG

### Command `/dashboard/command-center` _(parked)_
**Status:** Mock-data decorative page. Ο πραγματικός cockpit είναι
στο `/dashboard`. Παρκαρισμένο.

---

## 🤖 Telegram alerts — τι περιμένεις πότε

Όλα τα Telegram μηνύματα έρχονται από **GY Visitors bot**. Ώρες σε
Athens summer time (UTC+3):

| Cron | Athens | Τι |
|------|--------|------|
| `cockpit-briefing` | 07:00 | Daily cockpit (today's actions, pipeline pulse) |
| Site health check | 10:00 | `✅ Daily Health Check — All OK` (george-yachts) |
| `system-health-check` | 10:05 | Backend infra (gy-command) — 14 checks |
| `gmail-poll-replies` | every 5 min | HOT/WARM lead alerts on inbound replies |
| `inbox-star-sync` | every 15 min | Star changes propagated to CRM |
| `calendar-sync` | every 30 min | Calendar events refreshed |
| `pre-call-brief` | every hour | 30 min before each meeting |
| `commitments-surface` | 08:00 | Promises due today + overdue |
| `birthdays` | 11:00 | VIPs με γενέθλια σήμερα |
| `holidays` | 11:00 | Country holiday wishes drafted |
| `idle-leads` | 10:00 | Warm/Hot leads idle 7+ days |
| `instagram-publish` | 18:05 | IG post auto-publish (or skip if blocked) |
| `instagram-publish-reel` | 18:15 Wed/Fri | Reel publish |
| `tiktok-mirror` | 19:15 weekdays | ⏸️ blocked pending verification |
| `facebook-mirror` | 18:35 | FB cross-post |
| `ig-engagement-dm` | 11:00 | Daily 10 DM drafts (Outreach) |
| `instagram-engagement-digest` | 14:07 weekdays | 15 comment targets |
| `weekly-strategy` | 17:00 Fri | Next-week priorities |
| `founders-friday` | 18:00 Fri | Reflection prompt |
| `health-weekly-digest` | 09:00 Sun | Top warming/cooling contacts |
| `charter-whispers` | 07:00 Sun | Pattern detection insights |
| `brand-radar` | 09:00 Sun | SoV weekly summary |
| `competitor-scan` | 13:00 Sun | Site Explorer audit |

Αν κάποιο λείψει → αύριο πρωί στο `system-health-check` "Cron
failures (24h)" line θα φανεί.

---

## 🚨 Pending από εσένα (manual)

1. **Apps Script paste** (`docs/PER_BOT_STATS_PASTE.md`) — 5 min.
   Ξεμπλοκάρει: George prefix, daily-limit dedup once/24h, attached
   PDF, per-bot stats cards.

2. **Warmup cleanup** (1 endpoint call) — 5 min.
   ```
   GET  /api/admin/warmup-cleanup?secret=<CRON_SECRET>     # dry-run
   POST /api/admin/warmup-cleanup
        body: {"secret":"<CRON_SECRET>","confirm":true}    # execute
   ```

3. **Επιβεβαίωση** — αύριο 07:05 UTC δες αν το `system-health-check`
   βγάζει `✅ All OK` (όχι τα 4 false-positives από χθες).

---

## 🛣 Backlog (όταν θέλεις)

- LinkedIn family + TikTok mirror — περιμένουν dev verification.
- Email triage tabs — η σελίδα είναι ήδη single coherent workflow,
  δεν ωφελεί από tabs σήμερα.
- Brand Radar / Analytics tab restructure — πάλι single-view, low ROI.
- Big H Phase 4-7 (per proposal §5) — multi-week sprint.

---

_Last update: 2026-04-30_
_24+ commits ντε πέφταν το πρωί._
