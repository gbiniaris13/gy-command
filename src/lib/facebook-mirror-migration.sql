-- Facebook Page mirror extension for ig_posts.
--
-- Mirrors the TikTok pattern: the FB mirror cron reads published IG
-- rows and re-posts the asset to the corporate Page. These columns
-- track the FB side so the cron is idempotent and the dashboard can
-- surface per-platform status.

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS facebook_status TEXT
    CHECK (facebook_status IS NULL OR facebook_status IN ('pending', 'published', 'failed', 'skipped'));

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS facebook_post_id TEXT;

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS facebook_error TEXT;

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS facebook_published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ig_posts_facebook_mirror_candidates_idx
  ON ig_posts (published_at DESC)
  WHERE status = 'published' AND facebook_status IS NULL;
