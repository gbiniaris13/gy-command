-- Charter management fields on contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS charter_vessel text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS charter_start_date date;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS charter_guests int;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS charter_embarkation text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS charter_disembarkation text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS charter_fee numeric;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS charter_apa numeric;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS commission_earned numeric;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS commission_rate numeric;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS captain_name text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS captain_phone text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS charter_notes text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS vip boolean DEFAULT false;

-- Charter reminders
CREATE TABLE IF NOT EXISTS charter_reminders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  reminder_type text NOT NULL,
  reminder_date date NOT NULL,
  description text NOT NULL,
  completed boolean DEFAULT false,
  snoozed_until date,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reminders_date ON charter_reminders(reminder_date);
ALTER TABLE charter_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_access" ON charter_reminders FOR ALL USING (auth.role() = 'authenticated');

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type text NOT NULL,
  title text NOT NULL,
  description text,
  link text,
  read boolean DEFAULT false,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read, created_at DESC);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_access" ON notifications FOR ALL USING (auth.role() = 'authenticated');
