-- TikTok mirror extension for ig_posts.
--
-- The mirror cron reads ig_posts rows that already successfully
-- published to Instagram and publishes the same asset to TikTok.
-- These columns track the TT side of the lifecycle so we don't
-- double-publish and so the dashboard can show "IG ✓ · TT pending".

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS tiktok_status TEXT
    CHECK (tiktok_status IS NULL OR tiktok_status IN ('pending', 'published', 'failed', 'skipped'));

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS tiktok_publish_id TEXT;

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS tiktok_error TEXT;

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS tiktok_published_at TIMESTAMPTZ;

-- Partial index for the mirror cron's eligibility scan.
CREATE INDEX IF NOT EXISTS ig_posts_tiktok_mirror_candidates_idx
  ON ig_posts (published_at DESC)
  WHERE status = 'published' AND tiktok_status IS NULL;
