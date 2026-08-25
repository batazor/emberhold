-- VK is an identity, not a separate game account: saves, clans and
-- entitlements keep using auth.users UUIDs, exactly as with Telegram.
--
-- There is no VK payment table here on purpose. Payments in the VK client
-- are turned off until votes are wired up, and an unused claims table would
-- read as a half-finished feature rather than a deliberate absence.
create table public.vk_identities (
  vk_id bigint primary key check (vk_id > 0),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  platform text,
  language_code text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.vk_identities enable row level security;
revoke all on public.vk_identities from public, anon, authenticated;
