# The Instagram Bot — full reference

> Single source of truth for the @georgeyachts social automation that lives
> inside this CRM (`gy-command`). Written so we never have to re-investigate
> from scratch. Last verified: **2026-06-02**.

---

## 0. TL;DR — what works right now

| Channel | State | Why |
|---|---|---|
| **Instagram** (posts, reels, stories, carousels) | ✅ **Working, automatic, free** | Posts via `graph.instagram.com` using the `IG_ACCESS_TOKEN`. Media served from Cloudinary. |
| **Facebook Page mirror** | ⚪ **Dormant — ready** | Code is correct (posted successfully twice in the past). Needs **one free token** `FB_PAGE_ACCESS_TOKEN`. Auto-activates the moment it's set. See §7. |
| **TikTok mirror** | ⚪ **Dormant — needs external setup** | Needs a TikTok developer app + **app audit** + OAuth + domain verification. Free, but not a quick switch, and incompatible with Cloudinary `PULL_FROM_URL` (see §8). |

**Cost: €0.** Everything below runs on free tiers. No subscription, now or future.

---

## 1. Where it lives & how it runs

- **Repo:** `gy-command` (this CRM). There is **no separate bot app** — it's a
  set of Vercel **cron jobs** (`vercel.json` → `crons`) hitting API routes
  under `src/app/api/cron/instagram-*` (+ `facebook-mirror`, `tiktok-mirror`).
- **Reporting:** every action pings **Telegram** (`lib/telegram.ts`).
- **Brain/DB:** Supabase Postgres (project `lquxemsonehfltdzdbhq`).
- **Media:** **Cloudinary** (cloud `ddicit8fz`, folder `gy-ig/`). _Migrated off
  Supabase Storage on 2026-06-02 — Supabase was over its free 1 GB quota._

## 2. The cron schedule (all times UTC; Athens = +2 winter / +3 summer)

> **DST rule (2026-11-19).** Vercel crons are UTC-only. The feed window is
> 18:00–19:30 Athens, which is 15:00–16:30 UTC in summer and 16:00–17:30 UTC
> in winter. Feed crons therefore sit in **16:00–16:30 UTC**, the only slot
> inside the window all year. Any code that writes a `schedule_time` must use
> `athensWallClockToUtc()` (`src/lib/ig-window-guard.ts`), never a fixed
> `setUTCHours`. Ignoring this silenced the feed from 24 Oct to 19 Nov 2026.

| Cron | Schedule | Does |
|---|---|---|
| `instagram-fleet-post` | `0 16 * * 2,3,4,5` | Tue–Fri fleet/yacht feed post (cleared yachts only) |
| `instagram-publish` | `10 16 * * *` | Feed post for Mon/Sat slots filled by the weekly generator |
| `instagram-publish-reel` | _not scheduled_ | Removed (no stock reels); route kept for manual use |
| `instagram-stories` | `0 5,10,17 * * *` | 3×/day stories |
| `instagram-carousel` | `5 16 * * 1,4` | Mon/Thu carousel (currently `carousel_auto_publish` off) |
| `instagram-fleet-story-followup` | `0 */3 * * *` | Story follow-ups |
| `instagram-evergreen` | `0 7 1 * *` | Monthly evergreen |
| `instagram-generate-weekly` | `0 7 * * 0` | Weekly content generation |
| `instagram-health-check` | `0 7 * * 1` | Weekly health check |
| `instagram-watchdog` | `30 6 * * *` | Daily watchdog |
| `instagram-analytics` | `17 */6 * * *` | Engagement pull (every 6h) |
| `instagram-followers` | `11 3 * * *` | Follower count history |
| `instagram-monthly-report` | `0 8 1 * *` | Monthly report |
| `instagram-weekly-ops-report` | `0 7 * * 4` | Weekly ops report |
| `facebook-mirror` | `45 16 * * *` | Re-post the day's IG post to the FB Page (runs after publish) |
| `tiktok-mirror` | `50 16 * * 1-5` | Re-post IG content to TikTok (dormant — §8) |

## 3. Media — how the bot reads & writes (Cloudinary)

- **Photos** → table `ig_photos`, column `public_url` (full Cloudinary URL) +
  `storage_path` (Cloudinary `public_id`). The bot hands `public_url` to the
  Instagram Graph API, which fetches it server-side.
- **Videos / reels** → table `settings`, rows keyed `video_<id>`, JSON value
  with a `public_url` (Cloudinary). Reels also stash the video URL in
  `ig_posts.image_url`.
- **`isLibraryUrl()`** (`src/lib/ig-media.ts`) tells the publish cron "this is
  one of our library assets, don't swap it." Recognises Cloudinary `gy-ig/`
  URLs (and, defensively, the legacy Supabase host).

### Adding new stock media
- Photos: drop into `~/Desktop/ROBERTO IG /`, run `node scripts/sync-ig-photos.js`.
- Videos: drop into `~/Desktop/ROBERTO IG videos/`, run `node scripts/sync-ig-videos.js`.
- Both now upload to **Cloudinary** (via `src/lib/ig-media.ts`), **not Supabase** —
  so Supabase Storage can never fill up again. The dashboard upload zone
  (`/dashboard/instagram`) does the same.

### Free-forever guarantee
Cloudinary free tier = 25 credits/month (1 credit ≈ 1 GB storage **or** 1 GB
bandwidth **or** 1k transforms). Current footprint ≈ 1.1 GB + tiny per-post
bandwidth ≈ **~1.5 credits/month**. No card on file → it *blocks* on overage,
never bills.

## 4. Data model (key tables)

- `ig_photos` — photo library (id, filename, storage_path, public_url,
  description, tags, `used_in_post_id`, uploaded_at).
- `settings` — KV store. Holds `video_<id>` rows (the video library), feature
  flags (`reels_enabled`, `reel_auto_publish_without_approval`,
  `tiktok_enabled`), and cached tokens (`fb_page_token`, `tiktok_oauth`).
- `ig_posts` — every post (image_url, caption, status, post_type, ig_media_id,
  `facebook_status/_post_id/_error`, `tiktok_status/_publish_id/_error`).
- `ig_post_analytics`, `ig_follower_history`, `ig_competitors`,
  `ig_comment_replies`, `ig_dm_replies` — analytics & engagement.

## 5. Publishing flow & token strategy

`src/lib/ig-token.ts` is the single source of truth:

- **Preferred token:** `FB_PAGE_ACCESS_TOKEN` (a Meta **System User** Page token —
  never expires, survives IG password resets). Publishes via
  `graph.facebook.com/v21.0/{IG_BUSINESS_ID}`.
- **Fallback token:** `IG_ACCESS_TOKEN` (an Instagram-Login `IGAA…` token —
  dies on password reset). Publishes via `graph.instagram.com/v21.0/me`.

**Current state:** `FB_PAGE_ACCESS_TOKEN` is empty → the bot runs on the
**fallback** (`IG_ACCESS_TOKEN` + `graph.instagram.com`). IG works. ⚠️ This token
dies whenever the IG password changes — if IG posting suddenly fails with
"Invalid OAuth access token", refresh `IG_ACCESS_TOKEN` in Vercel env, or
(better) set a permanent `FB_PAGE_ACCESS_TOKEN` (§7) which also fixes Facebook.

## 6. Guards & approval gates

- **Window guard** (`ig-window-guard.ts`) — posts only in brand-safe Athens hours.
- **Rate-limit guard** (`rate-limit-guard.ts`) — respects Meta caps + jitter.
- **Stealth** (`meta-stealth.ts`) — randomized 0–8 min jitter so posts don't fire
  at exact cron offsets (anti-bot-detection).
- **Caption quality** — min length/word-count, brand-anchor keyword, no placeholders.
- **Banned-hashtag strip** + **caption-similarity** + **stock-photo deny-list**.
- **Telegram approval** — reels can require a tap (`reel_auto_publish_without_approval`).

## 6b. The silence alarm (2026-11-19)

`instagram-watchdog` (daily, 06:30 UTC) asks one question: since the last
feed post, on which posting days (Monday to Saturday, Athens) was a post due
and none went out? Rules live in `src/lib/ig-silence.ts`, tests in
`scripts/ig-tests/silence.test.ts`.

- **1 missed posting day** → ⚠️ Telegram notice.
- **2 or more** → 🚨 Telegram **and email** to George, every morning until a
  post goes out. The message names the missed dates, the last post, and what
  the feed crons reported (for example `skipped (window_guard) x7`).
- Sunday never counts. A Monday or Saturday the publisher skipped on purpose
  (stealth roll) is excused. Today never counts: the post goes out at 18:00.
- Feed posts only. Stories are not covered.

## 6c. Stories: what they ask for, and the test (2026-11-19)

A story published through the API **cannot carry a tappable link** (Meta:
"Publishing stickers (i.e., link, poll, location) is not supported"). For
seven months the banner said "Tap to view yacht" over an address nobody could
tap, and no site visit ever came from a story (0 of 17,030 sessions).

- The banner now asks for something the viewer can do inside Instagram, and
  alternates with every story: **"Link in bio"** and **"DM us"** (the yacht's
  name on yacht slots, "your dates" on Greece slots). Copy and rules:
  `src/lib/story-cta.ts`; tests: `scripts/ig-tests/story-cta.test.ts`.
- The Facebook mirror gets its own picture with `georgeyachts.com`.
- Which story carried which request is kept in `settings.story_cta_log_v1`
  (the rate-limit log is pruned after a week). `instagram-analytics` reads
  each live story's insights every six hours and keeps the highest reading.
- The Monday health report compares the two per 1,000 accounts reached:
  replies (DMs to the story) and profile visits. No verdict before 20
  measured stories each.
- **The picture itself** is drawn by `/api/og/story-image`. Rebuilt the same
  day: it used to fetch a symbol font, emoji artwork and the full-size photo
  at draw time with no time limit, and 18 of 20 stories in one week went out
  as bare photos when it stalled. It now draws nothing the bundled font
  lacks, asks the image host for a 1080x1920 JPEG, and fails fast. If the
  banner still cannot be drawn, the Telegram card says so and the story is
  left out of the test.

## 7. Facebook Page mirror — how to activate (free, ~5 min, one-time)

The mirror code is correct and **posted successfully before** — it only broke
when `FB_PAGE_ACCESS_TOKEN` was emptied. It now skips cleanly (no Telegram spam)
until the token is set, then **auto-resumes**.

**To turn it on (free):**
1. Go to **business.facebook.com → Business Settings → Users → System Users**.
2. Create (or pick) a System User → **Add Assets** → assign the George Yachts
   **Facebook Page** with *Manage Page / Content* and the linked **Instagram
   account** (`instagram_basic` + `instagram_content_publish` +
   `pages_manage_posts` + `pages_read_engagement`).
3. **Generate a new token** for that System User with those scopes → choose
   **"never expires"**. Copy it (`EAA…`).
4. In **Vercel → gy-command → Settings → Environment Variables**, set
   `FB_PAGE_ACCESS_TOKEN` = that token. Also set `FB_PAGE_ID` to the George
   Yachts Page numeric ID (Business Settings → Pages → click the Page → ID).
5. Redeploy (or wait for the next deploy). Done — next IG post mirrors to FB
   automatically, **and** IG publishing switches to the permanent token (no more
   password-reset breakage).

_Note:_ this is the only step a human must do — Meta will not issue a posting
token to anyone but the account owner. It is **free**. Cloudinary-hosted media
works directly with FB (no domain verification needed).

## 8. TikTok mirror — status & what it needs (free, but heavy)

Currently fully dormant: no `TIKTOK_CLIENT_KEY/SECRET`, no `tiktok_oauth` token,
`tiktok_enabled` flag off. The DB columns (`tiktok_status` etc.) now exist so the
cron won't crash when enabled.

To activate, **all** of these are required (all free, but non-trivial):
1. A **TikTok for Developers** app (client key/secret → Vercel env).
2. **Content Posting API audit/approval** by TikTok — without it, DIRECT_POST to
   public is blocked (posts land in your inbox / SELF_ONLY only).
3. **OAuth** connect `@george.yachts` once (`/api/auth/tiktok/callback` stores the
   token), then flip `settings.tiktok_enabled = "true"`.
4. **Domain/URL-prefix verification** — TikTok's `PULL_FROM_URL` requires the media
   URL's domain to be a *verified* property. Our media is on `res.cloudinary.com`
   (not ours) → PULL_FROM_URL won't pass. Either host reel videos on a verified
   `georgeyachts.com` URL, or switch the client to TikTok's chunked `FILE_UPLOAD`.

**Recommendation:** defer TikTok until the FB mirror is live and the app audit is
worth pursuing. It's free but gated on TikTok's review + a media-hosting change.

## 9. Admin / diagnostic endpoints (read-mostly)

- `GET /api/admin/poster-diagnose` — library depletion + posting health.
- `POST /api/admin/instagram-publish-now` `{post_id}` — emergency manual publish
  (bypasses cadence guards; keeps Meta rate-limit + quality guards).
- `POST /api/admin/upload-ig-image` — one-shot image upload into the Cloudinary
  library.
- `GET /api/instagram/photos/upload` / `…/videos/upload` — list library (used by
  sync scripts for dedup).

## 10. Failure modes & quick fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| IG "Invalid OAuth access token" | `IG_ACCESS_TOKEN` died on password reset | Refresh it in Vercel env, or set `FB_PAGE_ACCESS_TOKEN` (§7) |
| "PHOTO LIBRARY DEPLETED" Telegram | every `ig_photos` row used | add photos → `sync-ig-photos.js` |
| "No unused videos for Reels" | video library exhausted | add clips → `sync-ig-videos.js` |
| Facebook mirror silent | `FB_PAGE_ACCESS_TOKEN` unset (by design) | set it (§7) |
| Supabase Storage near quota | should not recur — IG media is on Cloudinary | check `cabin-photos`/`helm-proposals` only |
