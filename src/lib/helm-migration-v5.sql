-- =============================================================
-- THE HELM — Travel Agent request type. Additive & re-runnable.
-- Existing rows (including the real client) default to 'direct_client'
-- and are left completely untouched. The direct-client flow is unchanged.
-- Apply by pasting into the Supabase SQL editor.
-- =============================================================

-- 1) the column (additive, defaulted)
ALTER TABLE helm_requests ADD COLUMN IF NOT EXISTS request_type text DEFAULT 'direct_client';

-- 2) constrain the two valid values (guarded so re-runs are no-ops).
--    All existing rows are 'direct_client', so this validates cleanly.
DO $$ BEGIN
  ALTER TABLE helm_requests
    ADD CONSTRAINT helm_requests_request_type_chk
    CHECK (request_type IN ('direct_client','travel_agent'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3) expose request_type in the listing view (for the row badge + filter).
--    CREATE OR REPLACE keeps the existing view; security_invoker stays ON
--    so RLS on helm_requests is still honoured for non-service callers.
CREATE OR REPLACE VIEW helm_listing WITH (security_invoker = on) AS
SELECT r.id, r.status, r.client_name, r.client_email, r.occasion,
       r.dates_from, r.dates_to, r.area, r.follow_up_at, r.last_activity_at,
       r.proposal_pdf_path, r.mode, r.request_type, r.created_at,
       c.first_name, c.last_name, c.email AS contact_email
FROM helm_requests r
LEFT JOIN contacts c ON c.id = r.contact_id
ORDER BY r.last_activity_at DESC NULLS LAST;
