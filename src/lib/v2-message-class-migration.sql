-- ============================================================================
-- Sprint 2.1 — message classification + contact lifecycle states
--
-- Adds per-activity classification (so the analyzer can pick the
-- "last meaningful message" instead of just "last message"), plus
-- lifecycle markers on contacts for parked + declined + cold/closed.
-- ============================================================================

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS message_class             text,
  ADD COLUMN IF NOT EXISTS message_class_confidence  numeric,
  ADD COLUMN IF NOT EXISTS message_class_reason      text;

CREATE INDEX IF NOT EXISTS idx_activities_class
  ON activities(message_class)
  WHERE message_class IS NOT NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS parked_until      date,
  ADD COLUMN IF NOT EXISTS declined_at       timestamptz,
  ADD COLUMN IF NOT EXISTS declined_reason   text,
  ADD COLUMN IF NOT EXISTS lifecycle_state   text; -- 'active' | 'parked' | 'declined' | 'cold' | 'closed_no_response'

CREATE INDEX IF NOT EXISTS idx_contacts_parked_until
  ON contacts(parked_until)
  WHERE parked_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle
  ON contacts(lifecycle_state)
  WHERE lifecycle_state IS NOT NULL;
