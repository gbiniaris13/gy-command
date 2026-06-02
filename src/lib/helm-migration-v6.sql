-- =============================================================
-- THE HELM — central agency (supplier) email for broker-to-supplier
-- inquiries. Additive & re-runnable. Nullable; existing rows get NULL
-- and are otherwise untouched. Supports multiple addresses as a simple
-- comma-separated string (Gmail's To header accepts comma-separated).
-- Apply by pasting into the Supabase SQL editor.
-- =============================================================

ALTER TABLE helm_requests ADD COLUMN IF NOT EXISTS central_agency_email text;
