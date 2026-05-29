-- =============================================================
-- THE HELM — charter REQUEST pipeline (the "before": the sale).
-- Lives 100% inside gy-command. On Won, George hands off to The
-- Cabin (the "after": the voyage) manually — The Cabin is NOT
-- touched here.
--
-- Apply by pasting into the Supabase SQL editor (same pattern as
-- every other src/lib/*-migration.sql). Re-runnable.
-- =============================================================

-- ---- lifecycle enum ----------------------------------------
DO $$ BEGIN
  CREATE TYPE helm_status AS ENUM
    ('new','drafted','sent','in_conversation','negotiating','won','lost');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---- main request ------------------------------------------
CREATE TABLE IF NOT EXISTS helm_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- keep the request if the contact is deleted; just lose the link
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  status helm_status NOT NULL DEFAULT 'new',

  -- client / brief
  client_name      text,
  client_email     text,
  client_whatsapp  text,
  brief            text,          -- George's notes + the client's stated needs
  occasion         text,          -- wedding / birthday / family / corporate ... (drives tone)
  party_size       text,
  dates_from       date,
  dates_to         date,
  area             text,

  -- supplier side (source of truth, never shown to client raw)
  supplier_raw     text,          -- the raw central-agency email(s), pasted

  -- proposal
  mode             text CHECK (mode IN ('single','combined')),
  no_myba          boolean DEFAULT false,
  show_ghost_credit boolean DEFAULT true,
  proposal_json    jsonb,         -- computed payload fed to the renderer (see render-kit)
  proposal_pdf_path text,         -- Supabase Storage path in bucket 'helm-proposals'
  proposal_generated_at timestamptz,
  -- chosen photo links (Cabin pattern): [{ url, caption? }]
  vessel_photos    jsonb DEFAULT '[]'::jsonb,

  -- email
  email_subject    text,
  email_intro      text,          -- AI-generated, first-person George, editable before send
  gmail_thread_id  text,
  gmail_last_message_id text,

  -- pipeline ops
  last_activity_at timestamptz DEFAULT now(),
  follow_up_at     timestamptz,   -- set to now()+4d on send; cleared/bumped on reply
  won_reason       text,
  lost_reason      text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS helm_requests_status_idx   ON helm_requests(status);
CREATE INDEX IF NOT EXISTS helm_requests_followup_idx ON helm_requests(follow_up_at);
CREATE INDEX IF NOT EXISTS helm_requests_contact_idx  ON helm_requests(contact_id);
CREATE INDEX IF NOT EXISTS helm_requests_thread_idx   ON helm_requests(gmail_thread_id);

-- ---- conversation log (email / whatsapp / notes) -----------
CREATE TABLE IF NOT EXISTS helm_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id uuid REFERENCES helm_requests(id) ON DELETE CASCADE,
  direction text CHECK (direction IN ('outbound','inbound')),
  channel   text CHECK (channel  IN ('email','whatsapp','note')),
  body      text,
  gmail_message_id text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS helm_messages_request_idx ON helm_messages(request_id);

-- ---- admin listing view (mirrors cabin_listing) ------------
CREATE OR REPLACE VIEW helm_listing AS
SELECT r.id, r.status, r.client_name, r.client_email, r.occasion,
       r.dates_from, r.dates_to, r.area, r.follow_up_at, r.last_activity_at,
       r.proposal_pdf_path, r.mode, r.created_at,
       c.first_name, c.last_name, c.email AS contact_email
FROM helm_requests r
LEFT JOIN contacts c ON c.id = r.contact_id
ORDER BY r.last_activity_at DESC NULLS LAST;
