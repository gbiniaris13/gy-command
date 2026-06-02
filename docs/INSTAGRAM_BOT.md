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

## 2. The cron schedule (all times UTC; Athens = +2/+3)

| Cron | Schedule | Does |
|---|---|---|
| `instagram-fleet-post` | `0 15 * * 1,2,3,4` | Mon–Thu fleet/yacht feed post |
| `instagram-publish` | `30 15 * * *` | Daily feed photo post (caption + library photo) |
| `instagram-publish-reel` | `15 15 * * 3,5` | Wed/Fri reel (video) — gated by `reels_enabled` |
| `instagram-stories` | `0 5,10,17 * * *` | 3×/day stories |
| `instagram-carousel` | `5 15 * * 1,4` | Mon/Thu multi-image carousel |
| `instagram-fleet-story-followup` | `0 */3 * * *` | Story follow-ups |
| `instagram-evergreen` | `0 7 1 * *` | Monthly evergreen |
| `instagram-generate-weekly` | `0 7 * * 0` | Weekly content generation |
| `instagram-health-check` | `0 7 * * 1` | Weekly health check |
| `instagram-watchdog` | `30 6 * * *` | Daily watchdog |
| `instagram-analytics` | `17 */6 * * *` | Engagement pull (every 6h) |
| `instagram-followers` | `11 3 * * *` | Follower count history |
| `instagram-monthly-report` | `0 8 1 * *` | Monthly report |
| `instagram-weekly-ops-report` | `0 7 * * 4` | Weekly ops report |
| `facebook-mirror` | `45 15 * * *` | Re-post IG content to FB Page (dormant — §7) |
| `tiktok-mirror` | `15 16 * * 1-5` | Re-post IG content to TikTok (dormant — §8) |

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
