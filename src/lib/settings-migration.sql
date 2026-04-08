-- Settings table for key-value pairs (Google OAuth tokens, etc.)
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_access" ON settings FOR ALL USING (auth.role() = 'authenticated');

-- Email classifications from AI analysis
CREATE TABLE IF NOT EXISTS email_classifications (
  message_id text PRIMARY KEY,
  contact_id uuid REFERENCES contacts(id),
  classification text CHECK (classification IN ('HOT', 'WARM', 'COLD', 'NEUTRAL')),
  reason text,
  suggested_response text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE email_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_access" ON email_classifications FOR ALL USING (auth.role() = 'authenticated');
