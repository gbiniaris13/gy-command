-- Posting-window enforcement for the IG publish pipeline.
--
-- Context: 2026-04-22 two feed posts went live at 08:00 + 09:00 Athens.
-- Our UHNW audience was asleep / unavailable. The catch-all fix happens
-- in application code (src/lib/ig-window-guard.ts) so we can still alert
-- George via Telegram, but the database layer is the last line of
-- defense for any ad-hoc INSERT from the dashboard, an SQL session, or
-- a future bot we haven't written yet.
--
-- Run in the Supabase SQL editor. Idempotent.

-- 1. post_type column — so constraints can key off carousel vs fleet
--    vs reel. Stories live in a different table and don't need this.
ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS post_type TEXT;

-- Backfill: anything currently in the table is treated as a plain
-- image feed post. The guard in application code sets this on future
-- rows.
UPDATE ig_posts SET post_type = 'image' WHERE post_type IS NULL;

ALTER TABLE ig_posts
  ADD CONSTRAINT ig_posts_post_type_check
  CHECK (post_type IN ('image', 'carousel', 'reel', 'fleet_yacht'));

-- 2. scheduled_for — the field the publish cron actually consumes.
--    We already had `schedule_time TIMESTAMPTZ`; this is an alias
--    Roberto's brief uses. Create only if missing so existing queries
--    against schedule_time keep working. Both columns stay in sync via
--    a trigger — cheap, invisible, no migration of callers needed.
ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

-- Keep scheduled_for and schedule_time mirrored both ways.
CREATE OR REPLACE FUNCTION ig_posts_sync_schedule_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.scheduled_for IS NOT NULL AND NEW.schedule_time IS DISTINCT FROM NEW.scheduled_for THEN
    NEW.schedule_time := NEW.scheduled_for;
  ELSIF NEW.schedule_time IS NOT NULL AND NEW.scheduled_for IS DISTINCT FROM NEW.schedule_time THEN
    NEW.scheduled_for := NEW.schedule_time;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ig_posts_sync_schedule_columns_trg ON ig_posts;
CREATE TRIGGER ig_posts_sync_schedule_columns_trg
  BEFORE INSERT OR UPDATE ON ig_posts
  FOR EACH ROW
  EXECUTE FUNCTION ig_posts_sync_schedule_columns();

-- 3. Window constraint — 18:00 inclusive, 19:30 inclusive, Europe/Athens.
--    Postgres evaluates `AT TIME ZONE 'Europe/Athens'` with DST aware-
--    ness so this works in both summer and winter.
ALTER TABLE ig_posts DROP CONSTRAINT IF EXISTS ig_posts_window_check;
ALTER TABLE ig_posts
  ADD CONSTRAINT ig_posts_window_check
  CHECK (
    scheduled_for IS NULL
    OR (
      (EXTRACT(HOUR FROM scheduled_for AT TIME ZONE 'Europe/Athens')::int = 18)
      OR (
        EXTRACT(HOUR FROM scheduled_for AT TIME ZONE 'Europe/Athens')::int = 19
        AND EXTRACT(MINUTE FROM scheduled_for AT TIME ZONE 'Europe/Athens')::int <= 30
      )
    )
  );

-- 4. Fleet-yacht weekday constraint — Tue/Wed/Thu only (DOW 2/3/4).
ALTER TABLE ig_posts DROP CONSTRAINT IF EXISTS ig_posts_fleet_yacht_day_check;
ALTER TABLE ig_posts
  ADD CONSTRAINT ig_posts_fleet_yacht_day_check
  CHECK (
    post_type != 'fleet_yacht'
    OR scheduled_for IS NULL
    OR EXTRACT(DOW FROM scheduled_for AT TIME ZONE 'Europe/Athens')::int IN (2, 3, 4)
  );

-- 5. Helpful partial index for the 1/day + 18h-gap lookups the runtime
--    guard runs on every publish tick.
CREATE INDEX IF NOT EXISTS ig_posts_published_at_desc_idx
  ON ig_posts (published_at DESC)
  WHERE status = 'published';

-- Done. The application-layer guard (src/lib/ig-window-guard.ts)
-- duplicates these rules so Telegram alerts stay actionable.
