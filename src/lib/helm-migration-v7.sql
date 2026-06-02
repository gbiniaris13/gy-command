-- =============================================================
-- THE HELM — budget + special requests on a charter request, so the
-- central-agency availability inquiry can state them. Additive &
-- re-runnable; existing rows get NULL and are untouched.
-- Apply by pasting into the Supabase SQL editor.
-- =============================================================

ALTER TABLE helm_requests ADD COLUMN IF NOT EXISTS budget text;
ALTER TABLE helm_requests ADD COLUMN IF NOT EXISTS special_requests text;
