-- Migration: Instagram competitor watch
-- Run once in the Supabase SQL editor. /api/cron/instagram-competitors
-- writes one row per (date, username) with that day's follower count,
-- recent post count, and the average engagement of the last 5 posts.

CREATE TABLE IF NOT EXISTS public.ig_competitors (
  date date NOT NULL,
  username text NOT NULL,
  followers_count int,
  media_count int,
  posts_last_30d int,
  avg_likes_last_5 numeric,
  avg_comments_last_5 numeric,
  recorded_at timestamptz DEFAULT now(),
  PRIMARY KEY (date, username)
);

CREATE INDEX IF NOT EXISTS idx_ig_competitors_username_date
  ON public.ig_competitors(username, date DESC);

ALTER TABLE public.ig_competitors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_access" ON public.ig_competitors;
CREATE POLICY "auth_access" ON public.ig_competitors
  FOR ALL USING (auth.role() = 'authenticated');
