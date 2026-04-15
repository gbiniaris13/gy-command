-- Migration: AI Brand Radar — track AI visibility
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS brand_radar_scans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_date DATE NOT NULL DEFAULT CURRENT_DATE,
  query TEXT NOT NULL,
  response_preview TEXT,
  brand_mentioned BOOLEAN DEFAULT false,
  competitors_mentioned TEXT[] DEFAULT '{}',
  all_brands_mentioned TEXT[] DEFAULT '{}',
  model TEXT DEFAULT 'gemini',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_radar_date ON brand_radar_scans(scan_date DESC);
CREATE INDEX IF NOT EXISTS idx_brand_radar_mentioned ON brand_radar_scans(brand_mentioned, scan_date DESC);

ALTER TABLE brand_radar_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "br_all" ON brand_radar_scans FOR ALL USING (true) WITH CHECK (true);

-- Summary view for dashboard
CREATE TABLE IF NOT EXISTS brand_radar_weekly (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start DATE NOT NULL,
  total_queries INTEGER DEFAULT 0,
  brand_mentions INTEGER DEFAULT 0,
  share_of_voice NUMERIC(5,2) DEFAULT 0,
  top_competitor TEXT,
  top_competitor_mentions INTEGER DEFAULT 0,
  competitor_breakdown JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE brand_radar_weekly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brw_all" ON brand_radar_weekly FOR ALL USING (true) WITH CHECK (true);
