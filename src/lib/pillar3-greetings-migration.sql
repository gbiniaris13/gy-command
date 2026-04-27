-- ============================================================================
-- Pillar 3 — Relationship Maintenance Engine
--
-- Per-contact data needed to draft culturally appropriate greetings on
-- the right days. AUTO-DRAFTS ONLY — never auto-sends. Drafts land in
-- Gmail labelled gy-greetings/<holiday-name>; cockpit surfaces "N
-- greetings ready in drafts for tomorrow".
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS birthday          date,
  ADD COLUMN IF NOT EXISTS name_day          date,    -- Greek-only, mm-dd matters not the year
  ADD COLUMN IF NOT EXISTS inferred_religion text,    -- orthodox / catholic / protestant / muslim / jewish / hindu / buddhist / unknown
  ADD COLUMN IF NOT EXISTS religion_overridden boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS greetings_opt_out boolean DEFAULT false;

-- Notes:
--   * country column already exists in the contacts schema.
--   * birthday / name_day store the date as a real date for indexing;
--     only month + day are used by the cron, the year is whatever was
--     captured (often 1900 if only DOB-month-day was known).
--   * religion_overridden = true → AI inference skipped for this row.
--   * greetings_opt_out = true → no drafts ever generated (e.g. an
--     ex-client who asked to be left alone).

CREATE INDEX IF NOT EXISTS idx_contacts_birthday_md
  ON contacts ((extract(month from birthday)), (extract(day from birthday)))
  WHERE birthday IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_name_day_md
  ON contacts ((extract(month from name_day)), (extract(day from name_day)))
  WHERE name_day IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_religion
  ON contacts (inferred_religion)
  WHERE inferred_religion IS NOT NULL;

-- Audit log of drafts we've created so we don't re-draft the same
-- contact for the same holiday in the same year.
CREATE TABLE IF NOT EXISTS greeting_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid REFERENCES contacts(id) ON DELETE CASCADE,
  holiday_kind    text NOT NULL,        -- 'birthday' | 'name_day' | 'orthodox_easter' | ...
  holiday_year    int  NOT NULL,
  gmail_draft_id  text,
  gmail_label     text,
  generated_at    timestamptz DEFAULT now(),
  sent_at         timestamptz,          -- set when George sends from Gmail
  UNIQUE (contact_id, holiday_kind, holiday_year)
);

CREATE INDEX IF NOT EXISTS idx_greeting_drafts_contact ON greeting_drafts(contact_id);
CREATE INDEX IF NOT EXISTS idx_greeting_drafts_kind ON greeting_drafts(holiday_kind, holiday_year);
