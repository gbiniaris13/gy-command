-- ============================================================================
-- GY Command — George Yachts CRM
-- Database Schema for Supabase
-- ============================================================================
-- Paste this into the Supabase SQL Editor to create all tables.
-- ============================================================================

-- ─── Pipeline Stages ────────────────────────────────────────────────────────

CREATE TABLE pipeline_stages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  position int NOT NULL,
  color text DEFAULT '#C9A84C',
  created_at timestamptz DEFAULT now()
);

INSERT INTO pipeline_stages (name, position, color) VALUES
  ('New', 0, '#6B7B8D'),
  ('Contacted', 1, '#3B82F6'),
  ('Warm', 2, '#F59E0B'),
  ('Hot', 3, '#EF4444'),
  ('Meeting Booked', 4, '#8B5CF6'),
  ('Proposal Sent', 5, '#EC4899'),
  ('Closed Won', 6, '#10B981'),
  ('Closed Lost', 7, '#6B7280');

-- ─── Tags ───────────────────────────────────────────────────────────────────

CREATE TABLE tags (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  color text DEFAULT '#C9A84C',
  created_at timestamptz DEFAULT now()
);

INSERT INTO tags (name) VALUES
  ('Virtuoso'), ('Family Office'), ('Concierge'), ('Broker'),
  ('Charter Client'), ('Travel Agent'), ('VIP'), ('Repeat Client');

-- ─── Contacts (unified) ────────────────────────────────────────────────────

CREATE TABLE contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name text,
  last_name text,
  email text,
  phone text,
  company text,
  country text,
  city text,
  linkedin_url text,
  source text CHECK (source IN (
    'outreach_bot', 'website_lead', 'website_inquiry',
    'manual', 'referral', 'partner'
  )),
  pipeline_stage_id uuid REFERENCES pipeline_stages(id),
  yachts_viewed jsonb DEFAULT '[]',
  time_on_site int DEFAULT 0,
  last_activity_at timestamptz DEFAULT now(),
  merged_from uuid REFERENCES contacts(id),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_pipeline ON contacts(pipeline_stage_id);
CREATE INDEX idx_contacts_source ON contacts(source);
CREATE INDEX idx_contacts_country ON contacts(country);
CREATE INDEX idx_contacts_last_activity ON contacts(last_activity_at DESC);

-- ─── Contact Tags (many-to-many) ───────────────────────────────────────────

CREATE TABLE contact_tags (
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id uuid REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

-- ─── Activities (timeline) ─────────────────────────────────────────────────

CREATE TABLE activities (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'email_sent', 'email_received', 'call', 'meeting', 'note',
    'stage_change', 'website_visit', 'lead_captured',
    'proposal_sent', 'tag_added', 'tag_removed'
  )),
  description text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_activities_contact ON activities(contact_id);
CREATE INDEX idx_activities_type ON activities(type);
CREATE INDEX idx_activities_created ON activities(created_at DESC);

-- ─── Sessions (website visitor tracking) ───────────────────────────────────

CREATE TABLE sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  country text,
  city text,
  device_type text,
  referrer text,
  pages_visited jsonb DEFAULT '[]',
  yachts_viewed jsonb DEFAULT '[]',
  time_on_site int DEFAULT 0,
  is_hot_lead boolean DEFAULT false,
  lead_captured boolean DEFAULT false,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX idx_sessions_contact ON sessions(contact_id);
CREATE INDEX idx_sessions_started ON sessions(started_at DESC);

-- ─── Notes ─────────────────────────────────────────────────────────────────

CREATE TABLE notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ─── Row Level Security ────────────────────────────────────────────────────

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;

-- RLS Policies — allow authenticated users full access
CREATE POLICY "Authenticated access" ON contacts FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated access" ON activities FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated access" ON sessions FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated access" ON notes FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated access" ON pipeline_stages FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated access" ON tags FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated access" ON contact_tags FOR ALL USING (auth.role() = 'authenticated');
