-- Migration: ROBERTO IG photo library (AI-matched picker)
-- Run once in the Supabase SQL editor. Stores metadata for each photo
-- George uploads through the dashboard. Actual image bytes live in
-- the Supabase Storage bucket "ig-photos"; this table keeps the
-- AI-generated description + tags used by the matcher to pair a
-- caption with the best photo, and the dedup pointer to the ig_posts
-- row it was eventually used in.

CREATE TABLE IF NOT EXISTS public.ig_photos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  filename text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  public_url text NOT NULL,
  width int,
  height int,
  -- AI-generated caption / content description used by the matcher
  description text,
  -- Comma-separated tags used to narrow the candidate pool before
  -- the AI scoring step (sunset, aerial, interior, mykonos, etc)
  tags text[] DEFAULT '{}',
  -- Pointer to the ig_posts row this photo was used in — enforces
  -- "never duplicate"; NULL = still available.
  used_in_post_id uuid REFERENCES public.ig_posts(id) ON DELETE SET NULL,
  uploaded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ig_photos_used
  ON public.ig_photos(used_in_post_id);
CREATE INDEX IF NOT EXISTS idx_ig_photos_uploaded
  ON public.ig_photos(uploaded_at DESC);

ALTER TABLE public.ig_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_access" ON public.ig_photos;
CREATE POLICY "auth_access" ON public.ig_photos
  FOR ALL USING (auth.role() = 'authenticated');

-- The "ig-photos" Storage bucket must be created manually in the
-- Supabase dashboard (Storage → New bucket → Public: yes, name:
-- ig-photos). Alternatively, run the insert below in the Supabase
-- SQL editor — it lives on the internal storage.buckets table:
--
--   INSERT INTO storage.buckets (id, name, public)
--     VALUES ('ig-photos', 'ig-photos', true)
--     ON CONFLICT (id) DO NOTHING;
