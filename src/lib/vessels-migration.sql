-- Internal fleet/supplier vessel database.
-- These are vessels offered to George Yachts by central agents.
-- NEVER expose central_agent or central_agent_contact in client-facing output.

CREATE TABLE IF NOT EXISTS vessels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_name text NOT NULL,
  length_meters numeric,
  builder text,
  year_built int,
  year_refit int,
  guest_capacity int,
  cabin_count int,
  crew_count int,
  home_port text,
  cruising_region text,
  -- Central agent fields — INTERNAL ONLY, never client-facing
  central_agent text,
  central_agent_contact text,
  central_agent_contact_id uuid REFERENCES contacts(id),
  -- Rates
  rate_peak numeric,
  rate_shoulder numeric,
  rate_shoulder_high numeric,
  rate_shoulder_low numeric,
  vat_rate numeric DEFAULT 5.2,
  apa_rate numeric DEFAULT 35,
  -- Links & availability
  brochure_url text,
  availability_2026 text,
  -- Classification
  status text DEFAULT 'active_offering',  -- active_offering, expired, withdrawn
  tier text,                               -- premium, premium_plus, standard
  features text,
  ideal_for text,
  notes text,
  date_added date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_vessels_status ON vessels(status);
CREATE INDEX idx_vessels_central_agent ON vessels(central_agent);

-- RLS
ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON vessels FOR ALL
  USING (auth.role() = 'authenticated' OR current_setting('request.headers', true)::json->>'x-auth-bypass' = 'service');
