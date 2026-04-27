-- ============================================================================
-- Pillar 1.5 — Gmail STAR signal
--
-- George stars threads in Gmail that he wants to keep eyes on. We
-- promote starred contacts to the top of the cockpit regardless of
-- gap/stage — his manual signal beats any heuristic.
--
-- Set by:
--   - gmail-poll-replies cron when an inbound carries STARRED label
--   - inbox-backfill when a backfilled message carries STARRED label
--   - /api/gmail/star endpoint when George stars from the cockpit
--   - /api/cron/inbox-star-sync nightly to catch unstars + backfill
--
-- Cleared when ALL of the contact's recent threads lose the star.
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS inbox_starred           boolean   DEFAULT false,
  ADD COLUMN IF NOT EXISTS inbox_starred_at        timestamptz,
  ADD COLUMN IF NOT EXISTS inbox_starred_thread_id text;

CREATE INDEX IF NOT EXISTS idx_contacts_inbox_starred
  ON contacts(inbox_starred)
  WHERE inbox_starred = true;
