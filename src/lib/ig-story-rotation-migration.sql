-- Migration: rotate story photos to stop back-to-back duplicates.
--
-- Before this migration, the instagram-stories cron picked a random
-- photo from the top-5 most recently uploaded photos that hadn't been
-- used in a feed post yet — and never recorded that it did. Result:
-- the same ~5 photos rotated through stories forever, often back to
-- back. That's embarrassing for a luxury brand.
--
-- After this migration, the cron stamps `last_story_at` on the picked
-- photo after publishing, and filters/sorts by it. A photo used in a
-- story today will not be eligible again for 30 days (configurable
-- in the cron), and the literal previous photo can never be picked
-- twice in a row, even if the cooldown window would otherwise allow
-- it (belt + suspenders guard for a tiny photo library).
--
-- Feed dedup (`used_in_post_id`) is untouched — a photo used in a
-- feed post still never repeats in the feed, forever.

ALTER TABLE public.ig_photos
  ADD COLUMN IF NOT EXISTS last_story_at timestamptz;

-- Least-recently-used-first lookups run on every cron firing. Put
-- NULLs first so never-used-in-stories photos rank ahead of anything
-- actually used.
CREATE INDEX IF NOT EXISTS idx_ig_photos_last_story_at
  ON public.ig_photos(last_story_at ASC NULLS FIRST);
