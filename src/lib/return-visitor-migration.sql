-- Migration: track return visitors
-- Run this once in the Supabase SQL editor. The track route writes
-- visitor_id on every new_visit and flips is_return_visitor when a prior
-- session with the same visitor_id already exists.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS visitor_id text,
  ADD COLUMN IF NOT EXISTS is_return_visitor boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sessions_visitor_id ON sessions(visitor_id);
