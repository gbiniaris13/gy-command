-- ============================================================================
-- Sprint 2.4 — Pillar 5: Relationship Health Score
--
-- 0-100 score per contact, computed nightly. Captures the temperature
-- of the relationship: warming up, static, cooling down. Catches
-- soft-ghost patterns (Halilcan-style 65→28 in 2 weeks) before they
-- become permanent ghosts, and surfaces warming partners worth
-- investing in.
--
-- Composite formula (per brief §6.2):
--   100
--   - days_since_last_meaningful_exchange × decay_factor
--   + last_message_sentiment_score
--   + reply_rate_last_5_exchanges × engagement_weight
--   + deal_velocity (active deals progressing = boost)
--   - commitment_breach_penalty (open commitments past deadline)
--   + cultural_alignment_bonus (greetings sent and acknowledged)
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS health_score             int,
  ADD COLUMN IF NOT EXISTS health_score_at          timestamptz,
  ADD COLUMN IF NOT EXISTS health_score_trend       text,         -- 'up' | 'down' | 'flat' | null
  ADD COLUMN IF NOT EXISTS health_components        jsonb;        -- breakdown for the "why this score" tooltip

CREATE INDEX IF NOT EXISTS idx_contacts_health
  ON contacts(health_score DESC)
  WHERE health_score IS NOT NULL;

-- Per-message sentiment cache (cheap dedup so we don't re-AI on each
-- nightly recompute). Sentiment classes: 'cold' | 'neutral' | 'warm'
-- | 'very_warm'; engagement: 'one_line' | 'substantive' | 'detailed'
-- | 'with_questions'; intent: 'parked' | 'static' | 'advancing' |
-- 'closing'.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS sentiment_warmth      text,
  ADD COLUMN IF NOT EXISTS sentiment_engagement  text,
  ADD COLUMN IF NOT EXISTS sentiment_intent      text;

CREATE INDEX IF NOT EXISTS idx_activities_sentiment
  ON activities(sentiment_warmth)
  WHERE sentiment_warmth IS NOT NULL;

-- Snapshot table for trend computation. One row per contact per day
-- (or whenever the score changes meaningfully). Used to draw the 30-
-- day trend chart on the contact detail page + identify warming /
-- cooling top-10 in the weekly digest.
CREATE TABLE IF NOT EXISTS health_score_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   uuid REFERENCES contacts(id) ON DELETE CASCADE,
  score        int NOT NULL,
  computed_at  timestamptz DEFAULT now(),
  UNIQUE (contact_id, date_trunc('day', computed_at))
);

CREATE INDEX IF NOT EXISTS idx_health_history_contact
  ON health_score_history(contact_id, computed_at DESC);
