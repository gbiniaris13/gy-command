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

-- 2026-07-24 v2 (George: "μην μένεις στο παράθυρο των 2 λεπτών - δες τι κάνει
-- η HubSpot και κάν' το καλύτερο"). Every pixel/click hit is now LOGGED with
-- a verdict, HubSpot-style (bot list + rules) but per-hit, which our volume
-- affords: human | prefetch (delivery-window machine) | bot (scanner UA or
-- click burst) | apple-mpp (Apple's proxy preloads every image; open state
-- for those recipients is unknowable by design).
create table if not exists email_tracking_hits (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  kind text not null,
  at timestamptz not null default now(),
  user_agent text,
  ip text,
  url text,
  verdict text not null
);
create index if not exists email_tracking_hits_token_idx on email_tracking_hits (token, at desc);
alter table email_tracking_hits enable row level security;
