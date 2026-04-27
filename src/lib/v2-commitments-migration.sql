-- ============================================================================
-- Sprint 2.3 — Pillar 4: Promised Commitments Tracker
--
-- Every outbound email George sends gets scanned for commitment
-- language ("I'll send X by Monday", "I'll loop in our partners and
-- come back to you", "by tomorrow"). Extracted commitments live
-- here with a deadline. Cron surfaces them daily 08:00 Athens —
-- "⏰ Today you committed to: send Domenico the catamaran package".
--
-- Auto-marked fulfilled when George sends a reply addressing the
-- commitment (AI verifies the fulfillment message references the
-- ask).
-- ============================================================================

CREATE TABLE IF NOT EXISTS commitments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id              uuid REFERENCES contacts(id) ON DELETE CASCADE,
  thread_id               text,                          -- Gmail thread id (for fulfillment matching)
  source_message_id       text,                          -- Gmail message id of the email that contained the promise
  source_sent_at          timestamptz NOT NULL,          -- when George sent the original email
  commitment_text         text NOT NULL,                 -- verbatim sentence containing the promise
  commitment_summary      text,                          -- 1-line AI summary ("send catamaran package + Kyllini report")
  deadline_date           date,                          -- parsed deadline (NULL if "asap"/"soon" with no date)
  deadline_phrase         text,                          -- raw phrase used ("Monday", "early next week", "by 4/5")
  confidence              numeric NOT NULL DEFAULT 0.5,
  fulfilled_at            timestamptz,                   -- when George sent the fulfilling email
  fulfillment_message_id  text,                          -- Gmail message id that fulfilled it
  dismissed_at            timestamptz,                   -- George marked "skip" / "no longer relevant"
  dismiss_reason          text,
  created_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commitments_contact ON commitments(contact_id);
CREATE INDEX IF NOT EXISTS idx_commitments_thread  ON commitments(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commitments_open    ON commitments(deadline_date) WHERE fulfilled_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_commitments_source  ON commitments(source_message_id) WHERE source_message_id IS NOT NULL;
