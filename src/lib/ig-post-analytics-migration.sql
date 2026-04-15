-- Migration: Instagram post performance tracker
-- Run once in the Supabase SQL editor. /api/cron/instagram-analytics
-- upserts rows keyed on media_id after fetching the insights endpoint
-- for each post published in the last 7 days.

CREATE TABLE IF NOT EXISTS ig_post_analytics (
  media_id text PRIMARY KEY,
  permalink text,
  caption text,
  media_type text,
  media_url text,
  thumbnail_url text,
  published_at timestamptz,
  reach int DEFAULT 0,
  impressions int DEFAULT 0,
  likes int DEFAULT 0,
  comments int DEFAULT 0,
  saves int DEFAULT 0,
  shares int DEFAULT 0,
  profile_visits int DEFAULT 0,
  total_interactions int DEFAULT 0,
  fetched_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ig_post_analytics_published
  ON ig_post_analytics(published_at DESC);

ALTER TABLE ig_post_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_access" ON ig_post_analytics
  FOR ALL USING (auth.role() = 'authenticated');
