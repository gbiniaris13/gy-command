-- Migration: Instagram follower growth tracker
-- Run once in the Supabase SQL editor. /api/cron/instagram-followers
-- writes one row per day with the current followers_count.

CREATE TABLE IF NOT EXISTS ig_follower_history (
  date date PRIMARY KEY,
  followers_count int NOT NULL,
  follows_count int,
  media_count int,
  recorded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ig_follower_history_date
  ON ig_follower_history(date DESC);

ALTER TABLE ig_follower_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_access" ON ig_follower_history
  FOR ALL USING (auth.role() = 'authenticated');
