-- =============================================================
-- THE HELM — Addition B (media). Additive & re-runnable.
-- Paste into the Supabase SQL editor.
-- =============================================================

-- Brochure: a Cloudinary-hosted PDF URL OR a pasted (clean/white-label) link.
ALTER TABLE helm_requests ADD COLUMN IF NOT EXISTS brochure_url text;

-- vessel_photos jsonb already exists (default '[]'). Shape after Addition B:
--   [{ "url": "...", "source": "upload" | "link", "caption"?: "..." }]
-- No change needed here; documented for reference.
