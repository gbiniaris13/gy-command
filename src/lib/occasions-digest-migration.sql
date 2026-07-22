-- Occasions Digest migration (2026-07-21)
-- 1. Widen contacts.source CHECK to allow 'cabin_guest' — guests synced from
--    The Cabin manifests (people who have actually chartered with us). The
--    digest cron falls back to source='manual' until this runs, so nothing
--    breaks either way; running it just makes the segmentation clean.
-- 2. Index nationality for the national-days lookups.

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_source_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_source_check CHECK (source IN (
  'outreach_bot', 'website_lead', 'website_inquiry',
  'manual', 'referral', 'partner', 'cabin_guest'
));

CREATE INDEX IF NOT EXISTS idx_contacts_nationality
  ON contacts (nationality)
  WHERE nationality IS NOT NULL;
