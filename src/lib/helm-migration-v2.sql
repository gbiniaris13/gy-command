-- =============================================================
-- THE HELM — Step 3 (Generate) additions. Additive & re-runnable.
-- Paste into the Supabase SQL editor (after helm-migration.sql).
-- =============================================================

-- Formal client addressing (NEVER a bare first name). Title + surname,
-- or "the <surname> Family". The intake wizard collects these.
ALTER TABLE helm_requests ADD COLUMN IF NOT EXISTS client_title    text;     -- Mr / Mrs / Ms / Dr / Family
ALTER TABLE helm_requests ADD COLUMN IF NOT EXISTS client_surname  text;
ALTER TABLE helm_requests ADD COLUMN IF NOT EXISTS client_is_family boolean DEFAULT false;

-- Raw AI extraction of the supplier email: per-field {value, confidence,
-- snippet} + flags. Stored BEFORE any math, for the human review screen.
-- proposal_json (already exists) holds the final, confirmed, render-ready
-- payload after George confirms the numbers.
ALTER TABLE helm_requests ADD COLUMN IF NOT EXISTS extraction jsonb;
