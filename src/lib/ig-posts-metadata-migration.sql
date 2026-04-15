-- Migration: add metadata column to ig_posts for A/B style tracking
-- Run once in the Supabase SQL editor.

ALTER TABLE public.ig_posts
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ig_posts_metadata_style
  ON public.ig_posts ((metadata->>'style'));
