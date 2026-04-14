-- Migration: Add contact_type to contacts table
-- Run this in Supabase SQL Editor

-- Add the column with default
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS contact_type TEXT DEFAULT 'OUTREACH_LEAD';

-- Add a check constraint for valid values
ALTER TABLE contacts
ADD CONSTRAINT contacts_contact_type_check
CHECK (contact_type IN (
  'CENTRAL_AGENT',
  'B2B_PARTNER',
  'BROKER_CLIENT',
  'DIRECT_CLIENT',
  'PRESS_MEDIA',
  'INDUSTRY',
  'OUTREACH_LEAD'
));

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_contacts_contact_type ON contacts(contact_type);
