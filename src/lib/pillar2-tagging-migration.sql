-- ============================================================================
-- Pillar 2 — Smart Contact Database
--
-- Adds AI-driven category tagging to contacts. Multi-tag (a person can be
-- both travel_advisor AND b2b_partner). Each tag carries a confidence
-- score so the UI can flag low-confidence ones for review. A manual
-- override (boolean per tag) means George corrected it; the AI tagger
-- must NEVER overwrite a manually-set tag.
--
-- Tag vocabulary (per refocus brief Pillar 2 §3):
--   travel_advisor   — agency in signature, IATA number, booking title
--   charter_client   — requested a yacht, signed proposal, family/personal
--   b2b_partner      — yacht broker, charter manager, concierge, jet ops
--   press            — media outlet, journalist title
--   vendor           — invoicing, service provision
--   cold_lead        — single inbound, no clear category
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS tags_v2          jsonb     DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tags_overridden  boolean   DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags_analyzed_at timestamptz;

-- tags_v2 shape:
--   [
--     { "tag": "travel_advisor", "confidence": 0.92, "source": "ai" },
--     { "tag": "b2b_partner",    "confidence": 0.78, "source": "ai" }
--   ]
-- tags_overridden = true means George manually edited; AI tagger skips this row.

CREATE INDEX IF NOT EXISTS idx_contacts_tags_v2_gin ON contacts USING gin (tags_v2);
CREATE INDEX IF NOT EXISTS idx_contacts_tags_analyzed ON contacts(tags_analyzed_at);
