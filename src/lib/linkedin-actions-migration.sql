-- Migration: LinkedIn action log + safety enforcement
-- Run once in the Supabase SQL editor. Every LinkedIn action that
-- Domingo (Claude in Chrome) takes on George's behalf is logged here
-- so the safety-check endpoint can enforce the daily limits and the
-- dedup queries can avoid re-touching the same target.

CREATE TABLE IF NOT EXISTS public.linkedin_actions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Action type — one of:
  --   profile_view, connection_request, connection_message,
  --   comment, post, catch_up_message, like
  action_type text NOT NULL,
  -- LinkedIn URL of the target (post permalink, profile URL, etc.)
  target_url text,
  -- Profile name / handle for human-readable logs
  target_name text,
  -- Industry classification used to pick the right template
  target_industry text,
  -- Free-text content George approved (the comment, message body, etc.)
  content text,
  -- Status: pending_approval, approved, posted, rejected, failed
  status text NOT NULL DEFAULT 'pending_approval',
  -- Telegram message id of the approval request, if any
  telegram_message_id text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  posted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_linkedin_actions_created
  ON public.linkedin_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkedin_actions_type_date
  ON public.linkedin_actions(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkedin_actions_target
  ON public.linkedin_actions(target_url);

ALTER TABLE public.linkedin_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_access" ON public.linkedin_actions;
CREATE POLICY "auth_access" ON public.linkedin_actions
  FOR ALL USING (auth.role() = 'authenticated');
