-- =============================================================
-- THE HELM — Feature 1 (combined multi-yacht). Additive & re-runnable.
-- Per-yacht media for combined proposals, keyed by yacht index:
--   { "0": { "main_url": "...", "brochure_url": "..." }, "1": {...} }
-- =============================================================

ALTER TABLE helm_requests ADD COLUMN IF NOT EXISTS combined_media jsonb DEFAULT '{}'::jsonb;
