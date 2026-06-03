-- =============================================================
-- THE HELM — persist the in-progress review (per-yacht confirmed numbers,
-- seasons, discounts, embark/disembark, etc.) so a refresh / leaving the page
-- never loses the broker's work. Additive & re-runnable; nullable.
-- Apply by pasting into the Supabase SQL editor.
-- =============================================================

ALTER TABLE helm_requests ADD COLUMN IF NOT EXISTS review_draft jsonb;
