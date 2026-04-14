-- Migration: After-Sales Lifecycle Automation
-- Run in Supabase SQL Editor

-- 1. Add new columns to contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS nationality TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS religion TEXT DEFAULT 'unknown';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contract_signing_date DATE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS after_sales_stage TEXT DEFAULT 'none';

-- 2. Create automated_messages log table
CREATE TABLE IF NOT EXISTS automated_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL,
  subject TEXT,
  body_preview TEXT,
  channel TEXT DEFAULT 'email',
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automated_messages_contact ON automated_messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_automated_messages_type_date ON automated_messages(message_type, sent_at DESC);

ALTER TABLE automated_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON automated_messages FOR ALL USING (true) WITH CHECK (true);
