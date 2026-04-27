-- ============================================================================
-- Sprint 2.2 — per-thread suggested action + composite priority cache
--
-- AI-generated one-liner per top-N threads. Only regenerated when
-- the thread state changes meaningfully (new inbound, new commitment,
-- George replied) — otherwise the cached suggestion serves the
-- cockpit.
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS next_touch_suggestion       text,
  ADD COLUMN IF NOT EXISTS next_touch_suggestion_at    timestamptz,
  ADD COLUMN IF NOT EXISTS composite_priority_score    int;

CREATE INDEX IF NOT EXISTS idx_contacts_priority
  ON contacts(composite_priority_score DESC NULLS LAST)
  WHERE composite_priority_score IS NOT NULL;
