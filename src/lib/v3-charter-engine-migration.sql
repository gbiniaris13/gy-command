-- ============================================================================
-- v3 Sprint 3.2-3.4 — Pillar 7 + 8 + 9 combined migration
--
-- Pillar 8 (Document-Driven Charter Setup):
--   charter_documents — uploaded contract / passport / guest list / PIF
--   deals additions   — payment_status, charter dates, vessel, etc.
--
-- Pillar 7 (Charter Lifecycle Engine):
--   charter_lifecycle_milestones — the 17 timed touchpoints
--
-- Pillar 9 (Multi-Guest Network):
--   charter_guests — every person onboard, linked to deal + contact
--
-- All idempotent. Apply after the v2 batch.
-- ============================================================================

-- ─── deals (the missing table — currently denormalized into contacts) ──
-- Note: GY Command historically stored deal data on contacts directly
-- (charter_fee, charter_start_date, charter_vessel, etc). v3 normalizes
-- by also persisting in a deals table so multiple charters per contact
-- become first-class. The contacts row remains the SOURCE OF TRUTH for
-- the PRIMARY/most-recent deal so existing UI keeps working.

CREATE TABLE IF NOT EXISTS deals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  vessel_name          text,
  vessel_id            uuid,                       -- fk → vessels (if/when added)
  charter_start_date   date,
  charter_end_date     date,
  embark_port          text,
  disembark_port       text,
  guest_count          int,
  charter_fee_eur      numeric,
  apa_eur              numeric,
  vat_rate             numeric,
  vat_eur              numeric,
  total_eur            numeric,
  payment_status       text,                       -- pending | partial | paid | refunded
  contract_signed      boolean DEFAULT false,
  client_country       text,
  client_residency     text,
  charter_preferences  jsonb,                      -- PIF-extracted: dietary, allergies, music, special_occasions
  lifecycle_status     text,                       -- pending | active | in_progress | completed | cancelled
  lifecycle_activated_at timestamptz,
  notes                text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_primary_contact ON deals(primary_contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_charter_start ON deals(charter_start_date);
CREATE INDEX IF NOT EXISTS idx_deals_active_lifecycle
  ON deals(lifecycle_status)
  WHERE lifecycle_status IN ('active', 'in_progress');

-- ─── Pillar 8 — charter_documents ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS charter_documents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                 uuid REFERENCES deals(id) ON DELETE CASCADE,
  contact_id              uuid REFERENCES contacts(id) ON DELETE SET NULL,
  document_type           text NOT NULL,           -- contract | passport | guest_list | pif | accept_form | apa_receipt | invoice | itinerary | other
  file_path               text NOT NULL,           -- supabase storage path
  original_filename       text,
  mime_type               text,
  size_bytes              bigint,
  uploaded_by             text,                    -- email of uploader
  uploaded_at             timestamptz DEFAULT now(),
  extraction_status       text,                    -- pending | extracting | extracted | manual_review | failed
  extraction_started_at   timestamptz,
  extraction_completed_at timestamptz,
  extracted_data          jsonb,
  extraction_confidence   numeric,                 -- 0..1
  extraction_errors       text,
  ai_model_used           text,
  manual_review_at        timestamptz,
  manual_review_by        text,
  created_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_charter_docs_deal ON charter_documents(deal_id);
CREATE INDEX IF NOT EXISTS idx_charter_docs_contact ON charter_documents(contact_id);
CREATE INDEX IF NOT EXISTS idx_charter_docs_review
  ON charter_documents(extraction_status)
  WHERE extraction_status = 'manual_review';

-- ─── Pillar 9 — charter_guests ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS charter_guests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                 uuid REFERENCES deals(id) ON DELETE CASCADE,
  contact_id              uuid REFERENCES contacts(id) ON DELETE SET NULL,
  role                    text,                    -- primary | spouse | child | family | friend | colleague | unknown
  linked_via              text,                    -- passport_upload | guest_list | pif | email_thread | manual
  linked_at               timestamptz DEFAULT now(),
  emails_with_george_count int DEFAULT 0,
  last_email_with_george   date,
  post_charter_status      text,                   -- received_thanks | replied_warmly | silent | declined_followup
  notes                    text
);

CREATE INDEX IF NOT EXISTS idx_charter_guests_deal ON charter_guests(deal_id);
CREATE INDEX IF NOT EXISTS idx_charter_guests_contact ON charter_guests(contact_id);

-- Per-contact additions for Pillar 3 + 9 enrichment.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS nationality            text,
  ADD COLUMN IF NOT EXISTS country_of_residence   text,
  ADD COLUMN IF NOT EXISTS date_of_birth          date,
  ADD COLUMN IF NOT EXISTS is_minor               boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_email           text,
  ADD COLUMN IF NOT EXISTS passport_last_4        text,
  ADD COLUMN IF NOT EXISTS passport_expiry        date,
  ADD COLUMN IF NOT EXISTS relationship_to_primary text,
  ADD COLUMN IF NOT EXISTS network_source         text,        -- e.g. 'effie_star_jun_2026_charter'
  ADD COLUMN IF NOT EXISTS linked_charters        jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS subscribed_to_newsletter boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS unsubscribed_at        timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_minors ON contacts(is_minor) WHERE is_minor = true;
CREATE INDEX IF NOT EXISTS idx_contacts_birthday_md
  ON contacts (extract(month from date_of_birth), extract(day from date_of_birth))
  WHERE date_of_birth IS NOT NULL;

-- ─── Pillar 7 — charter_lifecycle_milestones ──────────────────────────

CREATE TABLE IF NOT EXISTS charter_lifecycle_milestones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id             uuid REFERENCES deals(id) ON DELETE CASCADE,
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  milestone_type      text NOT NULL,               -- T-60 | T-45 | T-40 | T-30 | T-21 | T-15 | T-14 | T-7 | T-3 | T-1 | T+0 | T+midpoint | T+disembark+1 | T+7 | T+30 | T+90 | T+annual
  due_date            date NOT NULL,
  status              text DEFAULT 'pending',      -- pending | completed | skipped | blocked
  auto_action         text,                        -- description of what the cron should do
  gmail_draft_id      text,
  gmail_draft_created_at timestamptz,
  calendar_event_id   text,
  notes               text,
  completed_at        timestamptz,
  completed_by        text,
  blocker_reason      text,                        -- when status = 'blocked', why?
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestones_deal ON charter_lifecycle_milestones(deal_id);
CREATE INDEX IF NOT EXISTS idx_milestones_due
  ON charter_lifecycle_milestones(due_date, status)
  WHERE status IN ('pending', 'blocked');
CREATE UNIQUE INDEX IF NOT EXISTS uq_milestone_per_deal_type
  ON charter_lifecycle_milestones(deal_id, milestone_type);
