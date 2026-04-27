-- ============================================================================
-- Inbox Brain — Pillar 1
-- Adds per-contact thread-state fields so the cockpit can rank threads
-- by Gmail conversation pattern (gap, direction, owed reply) instead of
-- only CRM stage.
--
-- Filled by src/lib/inbox-analyzer.ts. Reads activities of type
-- 'email_sent' / 'email_received' / 'email_inbound' for the contact.
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS inbox_last_inbound_at  timestamptz,
  ADD COLUMN IF NOT EXISTS inbox_last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS inbox_gap_days         int,
  ADD COLUMN IF NOT EXISTS inbox_inferred_stage   text,
  ADD COLUMN IF NOT EXISTS inbox_thread_id        text,
  ADD COLUMN IF NOT EXISTS inbox_last_subject     text,
  ADD COLUMN IF NOT EXISTS inbox_last_snippet     text,
  ADD COLUMN IF NOT EXISTS inbox_last_direction   text,
  ADD COLUMN IF NOT EXISTS inbox_message_count    int,
  ADD COLUMN IF NOT EXISTS inbox_analyzed_at      timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_inbox_stage
  ON contacts(inbox_inferred_stage);

CREATE INDEX IF NOT EXISTS idx_contacts_inbox_last_inbound
  ON contacts(inbox_last_inbound_at DESC);

-- The original activities CHECK constraint (schema.sql) only allows
-- 11 enum values, but the codebase writes many more in practice
-- ('email_inbound', 'email_reply_hot_or_warm', 'email_reply_cold',
-- 'idle_alert', 'meeting_booked', 'reply', 'ai_classification', etc).
-- Drop the CHECK so all current callers succeed and so the analyzer
-- can rely on a stable set of email_* types going forward.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_type_check'
  ) THEN
    ALTER TABLE activities DROP CONSTRAINT activities_type_check;
  END IF;
END $$;
