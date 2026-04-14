-- Migration: Create ig_dm_replies table for DM auto-reply rate limiting
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS ig_dm_replies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id TEXT NOT NULL,
  message_text TEXT,
  intent TEXT DEFAULT 'general',
  reply_text TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for rate limit lookups (sender + time)
CREATE INDEX IF NOT EXISTS idx_ig_dm_replies_sender_time
ON ig_dm_replies(sender_id, sent_at DESC);

-- RLS
ALTER TABLE ig_dm_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON ig_dm_replies FOR ALL USING (true) WITH CHECK (true);
