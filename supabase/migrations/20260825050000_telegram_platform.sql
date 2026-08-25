-- Telegram is an identity and a payment provider, not a separate game account.
-- Existing saves, clans and entitlements continue to use auth.users UUIDs.
create table public.telegram_identities (
  telegram_id bigint primary key check (telegram_id > 0),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  username text,
  first_name text not null default '',
  last_name text not null default '',
  language_code text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.telegram_checkout_claims (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  sku text not null,
  target_type text not null check (target_type in ('player', 'clan')),
  target_id uuid not null,
  stars bigint not null check (stars > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  used_at timestamptz,
  constraint telegram_checkout_token check (token ~ '^[A-Za-z0-9_-]{20,200}$')
);

create table public.telegram_payment_events (
  telegram_charge_id text primary key,
  provider_charge_id text,
  user_id uuid not null references auth.users (id) on delete cascade,
  sku text not null,
  target_type text not null check (target_type in ('player', 'clan')),
  target_id uuid not null,
  stars bigint not null check (stars > 0),
  processed_at timestamptz not null default now()
);

alter table public.telegram_identities enable row level security;
alter table public.telegram_checkout_claims enable row level security;
alter table public.telegram_payment_events enable row level security;
revoke all on public.telegram_identities from public, anon, authenticated;
revoke all on public.telegram_checkout_claims from public, anon, authenticated;
revoke all on public.telegram_payment_events from public, anon, authenticated;

create or replace function public.grant_telegram_entitlement(
  p_claim_token text,
  p_telegram_charge_id text,
  p_provider_charge_id text,
  p_stars bigint,
  p_telegram_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.telegram_checkout_claims%rowtype;
begin
  if exists (
    select 1 from public.telegram_payment_events
     where telegram_charge_id = p_telegram_charge_id
  ) then return false; end if;

  select * into v_claim
    from public.telegram_checkout_claims
   where token = p_claim_token
   for update;
  if not found or v_claim.used_at is not null or v_claim.expires_at <= now()
     or v_claim.stars <> p_stars or not exists (
       select 1 from public.telegram_identities identity
        where identity.user_id = v_claim.user_id
          and identity.telegram_id = p_telegram_id
     ) then
    raise exception 'invalid or expired Telegram checkout claim';
  end if;

  update public.telegram_checkout_claims set used_at = now() where token = p_claim_token;
  if v_claim.target_type = 'clan' then
    insert into public.clan_entitlements (
      clan_id, sku, purchased_by, stripe_checkout_session_id,
      stripe_payment_intent_id, amount_total, currency
    ) values (
      v_claim.target_id, v_claim.sku, v_claim.user_id,
      'telegram:' || p_telegram_charge_id, p_provider_charge_id, p_stars, 'xtr'
    ) on conflict (clan_id, sku) do nothing;
  else
    insert into public.player_entitlements (
      user_id, sku, stripe_checkout_session_id,
      stripe_payment_intent_id, amount_total, currency
    ) values (
      v_claim.target_id, v_claim.sku,
      'telegram:' || p_telegram_charge_id, p_provider_charge_id, p_stars, 'xtr'
    ) on conflict (user_id, sku) do nothing;
  end if;

  insert into public.telegram_payment_events (
    telegram_charge_id, provider_charge_id, user_id, sku,
    target_type, target_id, stars
  ) values (
    p_telegram_charge_id, p_provider_charge_id, v_claim.user_id, v_claim.sku,
    v_claim.target_type, v_claim.target_id, p_stars
  );
  return true;
end;
$$;

revoke all on function public.grant_telegram_entitlement(text, text, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.grant_telegram_entitlement(text, text, text, bigint, bigint)
  to service_role;
