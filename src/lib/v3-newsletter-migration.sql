-- ============================================================================
-- v3 Sprint 3.5 — Pillar 4 (Newsletter & Drip).
--
-- Two streams:
--   newsletter_general    one-to-many monthly to all opted-in contacts
--   newsletter_advisor    drip to travel advisors (B2B partners)
--
-- Tables:
--   newsletter_campaigns  the email itself (subject, body, status, audience def)
--   newsletter_sends      one row per recipient per campaign (open/click telemetry hooks)
--   audience_segments     reusable segment queries ("UHNW Florida", "Greek B2B agencies")
--
-- Idempotent. Apply via Supabase Studio after the v3 charter migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream               text NOT NULL,            -- general | advisor | bespoke
  subject              text NOT NULL,
  body_markdown        text,
  body_html            text,
  audience_definition  jsonb,                    -- {filters: [...], segment_id?: uuid}
  audience_size        int,                      -- snapshot at build time
  status               text DEFAULT 'draft',     -- draft | test_sent | approved | sending | sent | cancelled
  test_sent_to         text,                     -- comma-separated emails the test went to
  test_sent_at         timestamptz,
  approved_by          text,
  approved_at          timestamptz,
  scheduled_for        timestamptz,
  sent_at              timestamptz,
  ai_generated         boolean DEFAULT false,
  ai_model_used        text,
  ai_generation_notes  text,
  created_by           text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_stream ON newsletter_campaigns(stream);
CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_status ON newsletter_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_scheduled
  ON newsletter_campaigns(scheduled_for)
  WHERE status IN ('approved', 'draft');

CREATE TABLE IF NOT EXISTS newsletter_sends (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NOT NULL REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  contact_id        uuid REFERENCES contacts(id) ON DELETE SET NULL,
  recipient_email   text NOT NULL,
  gmail_draft_id    text,                        -- Gmail draft id while still pending
  gmail_message_id  text,                        -- after George presses send
  status            text DEFAULT 'pending',      -- pending | drafted | sent | bounced | unsubscribed | failed
  drafted_at        timestamptz,
  sent_at           timestamptz,
  open_count        int DEFAULT 0,
  click_count       int DEFAULT 0,
  last_open_at      timestamptz,
  last_click_at     timestamptz,
  bounce_reason     text,
  failure_reason    text,
  unsubscribe_token text UNIQUE,                 -- per-recipient one-click unsubscribe
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_sends_campaign ON newsletter_sends(campaign_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_sends_contact ON newsletter_sends(contact_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_sends_status ON newsletter_sends(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_send_per_campaign_email
  ON newsletter_sends(campaign_id, recipient_email);

CREATE TABLE IF NOT EXISTS audience_segments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  description       text,
  filter_definition jsonb NOT NULL,              -- e.g. { "contact_type": "TRAVEL_ADVISOR", "country": ["US","GB"] }
  is_archived       boolean DEFAULT false,
  created_by        text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audience_segments_active
  ON audience_segments(is_archived)
  WHERE is_archived = false;

-- Seed two canonical segments.
INSERT INTO audience_segments (name, description, filter_definition, created_by)
SELECT 'All opted-in contacts',
       'Default monthly newsletter audience',
       '{"subscribed_to_newsletter": true, "has_email": true}'::jsonb,
       'system'
WHERE NOT EXISTS (
  SELECT 1 FROM audience_segments WHERE name = 'All opted-in contacts'
);

INSERT INTO audience_segments (name, description, filter_definition, created_by)
SELECT 'Travel advisors',
       'B2B travel advisors and partner agencies for the advisor drip',
       '{"contact_type": "TRAVEL_ADVISOR", "subscribed_to_newsletter": true, "has_email": true}'::jsonb,
       'system'
WHERE NOT EXISTS (
  SELECT 1 FROM audience_segments WHERE name = 'Travel advisors'
);
