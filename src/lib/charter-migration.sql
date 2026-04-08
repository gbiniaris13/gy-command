-- Post-charter follow-up fields
-- Run this migration on the Supabase dashboard or via CLI.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS charter_end_date date;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS post_charter_step int DEFAULT 0;

-- Index for the cron job query
CREATE INDEX IF NOT EXISTS idx_contacts_charter_followup
  ON contacts (charter_end_date, post_charter_step)
  WHERE charter_end_date IS NOT NULL;
