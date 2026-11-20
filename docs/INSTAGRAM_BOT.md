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
| `instagram-fleet-post` | `0 16 * * 3,5` | Wed + Fri yacht carousel with text cards (cleared yachts only), §6d. Also what Tue/Thu fall back to when no reel is ready |
| `instagram-reel-prepare` | `0 12,14 * * 2,4` | Tue + Thu: makes that evening's walkthrough reel and leaves it ready, §6f |
| `instagram-reel` | `0 16 * * 2,4` | Tue + Thu: publishes the ready reel (Thursday as a Trial Reel), §6f |
| `instagram-guide` | `5 16 * * 1,6` | Mon + Sat guide carousel (costs, how it works, where, who, shortlists), §6e |
| `instagram-publish` | `10 16 * * *` | Publishes any row still queued in `ig_posts` (normally none since 2026-11-19) |
| `instagram-publish-reel` | _not scheduled_ | Removed (no stock reels); route kept for manual use |
| `instagram-stories` | `0 5,10,17 * * *` | 3×/day stories |
| `instagram-carousel` | _not scheduled_ | Replaced by `instagram-guide` on 2026-11-19 |
| `instagram-fleet-story-followup` | `0 */3 * * *` | Story follow-ups |
| `instagram-evergreen` | _not scheduled_ | Retired 2026-11-19 (generated rewrites of old captions) |
| `instagram-generate-weekly` | _not scheduled_ | Retired 2026-11-19 (generated "lifestyle" captions); the route answers `retired` |
| `instagram-health-check` | `0 7 * * 1` | Weekly health check |
| `instagram-watchdog` | `30 6 * * *` | Daily silence alarm (§6b). No longer refills a queue |
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
  alternates with every story: **"Link in bio"** and **"DM me"** (the yacht's
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

## 6d. Yacht posts, second version (2026-11-19)

The yacht carousel (`/api/cron/instagram-fleet-post`, Tue to Fri) used to be
seven photographs and a caption in the voice of a magazine. It is now built
to be saved, sent and answered:

- **Text cards between the photographs**, up to three, drawn at the shape of
  the first photograph (Instagram crops every slide to the first):
  1. *George's note*: whole sentences, word for word, from the yacht's
     insider tip in Sanity, signed "George P. Biniaris".
  2. *Who she suits*: his "ideal for" entry, as short lines when he wrote a
     list and as one sentence when he wrote a sentence.
  3. *The week, in numbers*: the weekly fee as the site states it, the APA
     band for her category, VAT "at the yacht's certified rate", crew
     gratuity. Figures mirror the public site's `lib/apaFacts.js`. No card
     when the price is on request or not per yacht per week.
  Order: hero, note, half the photographs, suits, the rest, cost. All of it
  is `src/lib/fleet-cards.ts` (pure; tests in
  `scripts/ig-tests/fleet-cards.test.ts`). The picture is drawn by
  `/api/og/post-card` and stored under `gy-ig/cards/` by
  `src/lib/fleet-card-render.ts`. A card that cannot be drawn is left out;
  a slide Instagram refuses is left out; neither stops the post.
- **Voice.** First person, as George, and only from what he has written on
  the yacht's page. The model may rephrase his words; it may not add a
  view, a memory, a client or years of experience. `inventedExperience()`
  checks the result: one retry, then the plain fallback (his own first
  sentence and the yacht's facts). No emoji, no magazine words, the yacht's
  name without its catalogue prefix.
- **The closing line is written in code**, not by the model, and rotates by
  day: DM the yacht's name, send this to whoever is organising, DM your
  dates. Then three to five hashtags (was a block of generic ones).
- **Alt text on every slide** (what the photograph shows, or the card's
  words). If Meta refuses a slide with alt text, it is tried once without.
- **Three photographs are enough** (was four): a yacht enters the rotation
  with three known exteriors, and the old floor could pick her and then
  drop the day's post.
- **Preview without publishing**: `GET /api/admin/fleet-dryrun` (signed in,
  or the cron bearer) returns the caption and the slides in order;
  `?yacht_id=` forces a yacht; `?render=1` also draws and stores the cards,
  to prove the whole path.

## 6e. Guide carousels, Monday and Saturday (2026-11-19)

Monday and Saturday used to carry a generated caption over a stock photograph
("The first light of dawn paints the Aegean..."). That job, the monthly
"evergreen" rewrite and the watchdog's habit of calling them are retired.
In their place `/api/cron/instagram-guide` publishes one guide carousel,
1080x1350, with no approval step (switch: `settings.guide_posts_enabled`,
anything but `false` is on).

- **Written guides** (11): what a week costs, the APA, booking in five
  steps, when to book, Cyclades or Saronic or Ionian, the best month, what
  a MYBA contract fixes, four checks on a broker, weeks not days, who
  answers, no owned yachts. **Every sentence comes from the public site**
  (`george-yachts/lib/houseFaq.js`, `lib/apaFacts.js`), turned into the first
  person where the site says George does the thing himself. Nothing is
  generated at publish time. No price is written by hand: the cost guide's
  worked example reads a live yacht's fee and applies the published bands.
- **Live shortlists** (7): "Five crewed yachts for ten guests in Greece" and
  the like, built at publish time from the cleared fleet, cheapest first,
  each slide her photograph, her facts, her weekly fee and George's own line
  about her. Only cleared yachts with a stated per-week fee and a known
  exterior photograph. Fewer than three matches: no shortlist that day.
- **Rotation**: two written guides, then a shortlist; the turn number lives
  in `settings.guide_turn_v1` and advances only when a post is published.
  Turn 0 is the cost guide.
- **Every slide is needed.** Each is drawn by `/api/og/guide-card` (cron
  secret or dashboard session only), tried twice, stored under
  `gy-ig/guides/`. If the planned deck cannot be drawn (usually a photograph
  that will not load) a written guide with no photograph goes instead. If
  Instagram refuses a slide, nothing is published and Telegram says why.
- **Caption**: the deck's own paragraph (plain search words first), the same
  "DM me \"COST\" ..." line as the closing card, three to five hashtags.
  Alt text on every slide is the slide's words. First comment: the site page
  that says the same at length.
- **Files**: `src/lib/guide-decks.ts` (the words and the rotation; pure,
  tests in `scripts/ig-tests/guide-decks.test.ts`, which also enforce the
  house rules on every deck: no dashes, no "we", no price per person, no
  figure on VAT, nothing invented), `src/lib/guide-pool.ts`,
  `src/lib/guide-render.ts`, `src/app/api/og/guide-card/route.tsx`.
- **Preview without publishing**: `GET /api/admin/guide-dryrun`
  (`?turn=`, `?deck=apa`, `?shortlist=ten-guests`, `?list=1`, `?render=1`).
- **To add a guide**: append to `GUIDE_DECKS` with the site file the words
  come from, run the tests. To change a fact, change the site first.

## 6f. Walkthrough reels, Tuesday and Thursday (2026-11-19)

Reels are how the account reaches people who do not follow it, and it had
stopped making them. George's rules: no generated or animated video, he
records nothing, the yachts' own walkthrough films may be used for cleared
yachts only, and no other company's name, logo or watermark, ever.

**The week is now:** Mon guide · Tue reel · Wed yacht carousel · Thu reel
(trial) · Fri yacht carousel · Sat guide · Sun stories only.

- **What a reel is**: eighteen seconds of the yacht's own film (`video.url`
  on her Sanity document), kept in its own shape in a 1080x810 band across
  a 1080x1920 navy screen. Her name and facts sit above it. Below it,
  George's own written words change every six seconds: his note, who she
  suits, what the week costs and "DM me \"NAME\"". Same words as the
  carousel cards, cut from his text and never rewritten. No sound: the
  film's music is not this house's to publish. The caption is not written
  by a model either: her name and type, his note word for word, her fee.
- **The logo check.** The opening and closing tenth of a film are never
  used. From the chosen stretch (the middle first, then two others) a still
  frame every two seconds is shown to the vision model with one question:
  is there a company name, logo, watermark, address or caption in this
  picture (her own name on the hull and the builder's badge do not count).
  One marked frame, or one frame with no answer, and that stretch is not
  used. Every stretch marked: the yacht is set aside for sixty days
  (`settings.reel_state_v1.rejected`). The check errs on the side of
  refusing; in the first test it turned down a crew jacket with a badge.
- **Two jobs.** `instagram-reel-prepare` (12:00 and 14:00 UTC) picks the
  next cleared yacht with a film (never shown first, then longest ago),
  stores the film in Cloudinary, runs the check, draws the three frames
  (`/api/og/reel-frame`, transparent PNG), and asks Cloudinary for the reel
  as a derived version of the stored film. The result waits in
  `settings.reel_ready_v1`; Telegram gets the address to look at.
  `instagram-reel` (16:00 UTC) publishes it, writes `ig_posts`
  (`metadata.kind = "reel_walkthrough"`), comments the yacht's page, and
  deletes the stored film and frames again, so storage does not grow.
- **Never a silent day.** No reel waiting, reels switched off
  (`settings.reel_posts_enabled = "false"`), Instagram refusing the film or
  not finishing it: the job calls `instagram-fleet-post` and a yacht
  carousel goes out instead.
- **Trial Reel on Thursday** (`settings.reel_trial_thursday`, anything but
  `false` is on): published with `trial_params.graduation_strategy =
  SS_PERFORMANCE`, so Instagram shows it to non-followers first and moves
  it to the profile by itself if it does well. A trial that does not do
  well never appears on the profile grid; that is how the feature works. If
  Instagram refuses the trial settings, the reel goes out as a normal one.
- **Cost**: Cloudinary free plan (25 credits a month; the account used 1.6
  when this was built). A reel is one stored film for a few hours, about
  ten still frames and one derived video of 2 to 3 MB.
- **Files**: `src/lib/reel-plan.ts` (pure: frames, stretches, recipe,
  caption; tests in `scripts/ig-tests/reel-plan.test.ts`),
  `src/lib/reel-build.ts`, `src/app/api/og/reel-frame/route.tsx`, the two
  cron routes.
- **Preview without publishing**: `GET /api/admin/reel-dryrun` (who is next,
  what is waiting, who was set aside); `?yacht_id=…&make=1` really makes her
  reel and returns its address; `&container=1` also hands it to Instagram as
  an unpublished container to prove Instagram accepts the file.

## 6g. Comments and messages: what the account says on its own (2026-11-19)

Until this date three things answered people by themselves
(`/api/webhooks/instagram`): a model wrote replies to comments in a brand
voice, direct messages got one of three canned texts with a booking link
"with our team", and a story mention got a thank-you with emoji. All gone.
The research verdict George adopted: no conversational bot, ever; people who
find out they were talking to one trust less and buy less.

George answers every comment and every message himself. The account does
exactly two things on its own, both openly automatic and signed
"George P. Biniaris" (words and rules: `src/lib/ig-inbox.ts`, tests in
`scripts/ig-tests/ig-inbox.test.ts`):

1. **The night note.** A written message that arrives between 00:00 and
   08:00 Athens gets one note: this is automatic, it is night in Athens, I
   am George, I reply by 09:00 Athens (the hour in New York is worked out),
   tell me your dates, guests and rough budget. Once per person per week.
   Never by day.
2. **The keyword note.** A comment that is little more than one of the words
   a post asked for (`COST`, `APA`, `DATES`, `WHERE`, `WHEN`, `SIX`, `EIGHT`,
   `TEN`, `TWELVE`, `CAT`, `POWER`, `MOTOR`) gets one private message with
   the site page the post promised. A sentence that merely contains such a
   word is a person talking and is left for George.

Everything that arrives is sent to Telegram with the text and "nothing was
answered for you", logged (`ig_comment_replies`, `ig_dm_replies`) and added
to the dashboard notifications. Nothing public is posted from the webhook.
Emoji-only comments and scraper hooks are logged and not pinged.

**Whether any of this reaches the app depends on Meta, not on this code.**
The old file used an Instagram-login token that stopped working in 2026; the
new one uses the same token as the publishing crons, through
`graph.facebook.com`. Messages need the Meta app to hold
`instagram_manage_messages` and the Page to have the app subscribed to
`messages` and `comments`. `GET /api/admin/ig-inbox-check` (read-only) says
which of these is true today. If messages cannot be sent from here, the same
night note can be set once, by hand and for free, in Meta Business Suite
(Inbox, Automations, Away message, 00:00 to 08:00) with the text from
`awayNote()`.

## 6h. The Monday scorecard (2026-11-19)

The weekly health report (`instagram-health-check`, Monday 07:00 UTC, on
Telegram) now ends with the numbers the research says predict an enquiry,
this week against last week and against the research's target for this
point in the plan (day 30, 60, 90 from 2026-11-19): people reached per reel,
saves per post, sends per 1,000 reached, profile visits per post, site
visits from Instagram, messages received, comments from people, briefs sent
by visitors who came from Instagram. A post the analytics job has not read
yet shows as "not measured yet", never as zero. Words and sums:
`src/lib/ig-scorecard.ts` (tests in `scripts/ig-tests/ig-scorecard.test.ts`).
The targets are the research's judgement, printed so a number has something
to be read against; they are not a promise.

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
