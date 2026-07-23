-- 2026-07-23 — Email open/click tracking (George: "είτε στέλνω εγώ, είτε το
-- Helm, είτε το Cabin — να παίρνω αναφορά πότε το άνοιξε, τι πάτησε, πόσες
-- φορές, με email πίσω σε μένα"). Free, local, no third-party tracker.
-- Run in Supabase SQL Editor on the LIVE project (ojpcmnnqohxlfsudvxcz).

create table if not exists email_tracking (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  source text not null,               -- 'helm' | 'helm-draft' | 'cabin' | 'system'
  recipient text,
  subject text,
  sent_at timestamptz not null default now(),
  first_open_at timestamptz,
  last_open_at timestamptz,
  open_count int not null default 0,
  first_click_at timestamptz,
  last_click_at timestamptz,
  click_count int not null default 0,
  last_click_url text,
  open_notified boolean not null default false,
  click_notified boolean not null default false
);

create index if not exists email_tracking_token_idx on email_tracking (token);
create index if not exists email_tracking_sent_at_idx on email_tracking (sent_at desc);

alter table email_tracking enable row level security;
-- Service-role key bypasses RLS; no public policies on purpose.
