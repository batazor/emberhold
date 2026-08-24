-- Paid map cosmetics have two owners: an account or a canonical clan.
-- A clan is a server entity even while the current game only has founders;
-- purchases must survive the payer leaving or deleting their account.
create table public.clans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  founder_user_id uuid references auth.users (id) on delete set null,
  camp_icon text not null default 'default',
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint clans_name_len check (char_length(name) between 2 and 24),
  constraint clans_camp_icon check (camp_icon in ('default', 'banner_tower', 'council_totem'))
);

create table public.clan_memberships (
  clan_id uuid not null references public.clans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (clan_id, user_id),
  unique (user_id),
  constraint clan_memberships_role check (role in ('leader', 'officer', 'member'))
);

create table public.clan_entitlements (
  clan_id uuid not null references public.clans (id) on delete cascade,
  sku text not null,
  purchased_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  stripe_checkout_session_id text not null,
  stripe_payment_intent_id text,
  amount_total bigint not null check (amount_total >= 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  primary key (clan_id, sku),
  unique (stripe_checkout_session_id)
);

create table public.player_cosmetic_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  camp_icon text not null default 'default',
  updated_at timestamptz not null default now(),
  constraint player_cosmetic_settings_camp_icon
    check (camp_icon in ('default', 'watchfire', 'horned_tent'))
);

alter table public.camps
  add column clan_id uuid references public.clans (id) on delete set null,
  add column camp_icon text not null default 'default',
  add constraint camps_camp_icon check (camp_icon in ('default', 'watchfire', 'horned_tent'));

alter table public.stripe_checkout_claims
  add column target_type text not null default 'player',
  add column target_id uuid;
update public.stripe_checkout_claims set target_id = user_id where target_id is null;
alter table public.stripe_checkout_claims
  alter column target_id set not null,
  add constraint stripe_checkout_claims_target_type check (target_type in ('player', 'clan'));

alter table public.stripe_webhook_events
  add column target_type text not null default 'player',
  add column target_id uuid;
update public.stripe_webhook_events set target_id = user_id where target_id is null;
alter table public.stripe_webhook_events
  alter column target_id set not null,
  add constraint stripe_webhook_events_target_type check (target_type in ('player', 'clan'));

alter table public.clans enable row level security;
alter table public.clan_memberships enable row level security;
alter table public.clan_entitlements enable row level security;
alter table public.player_cosmetic_settings enable row level security;

create policy "clans: read all" on public.clans for select using (true);
create policy "memberships: read own" on public.clan_memberships for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "players read own cosmetic settings" on public.player_cosmetic_settings
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.clans from anon, authenticated;
revoke all on public.clan_memberships from anon, authenticated;
revoke all on public.clan_entitlements from anon, authenticated;
revoke all on public.player_cosmetic_settings from anon, authenticated;
grant select on public.clans to authenticated;
grant select on public.clan_memberships to authenticated;
grant select on public.player_cosmetic_settings to authenticated;

-- The public camp row always mirrors server-owned cosmetic settings. Direct
-- writes to camp_icon or clan_id are ignored even though the rest of the camp
-- summary is intentionally client-authored in the current simulation.
create or replace function public.normalize_public_camp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan_id uuid;
begin
  select membership.clan_id into v_clan_id
    from public.clan_memberships membership
   where membership.user_id = new.user_id;
  new.clan_id := v_clan_id;
  new.clan := case when v_clan_id is null then null
    else (select clan.name from public.clans clan where clan.id = v_clan_id) end;
  new.camp_icon := coalesce((
    select settings.camp_icon
      from public.player_cosmetic_settings settings
     where settings.user_id = new.user_id
  ), 'default');
  return new;
end;
$$;

create trigger camps_normalize_public
before insert or update on public.camps
for each row execute function public.normalize_public_camp();

create or replace function public.sync_public_camp_icon()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.camps set camp_icon = new.camp_icon where user_id = new.user_id;
  return new;
end;
$$;

create trigger player_cosmetic_settings_sync
after insert or update of camp_icon on public.player_cosmetic_settings
for each row execute function public.sync_public_camp_icon();

-- Founding is idempotent for the current account. The immutable UUID, not
-- the mutable display name, becomes the owner of clan purchases.
create or replace function public.ensure_owned_clan(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_clan uuid;
  v_name text := btrim(p_name);
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 24 then
    raise exception 'invalid clan name';
  end if;

  select membership.clan_id into v_clan
    from public.clan_memberships membership
   where membership.user_id = v_user;
  if v_clan is null then
    insert into public.clans (name, founder_user_id)
      values (v_name, v_user)
      returning id into v_clan;
    insert into public.clan_memberships (clan_id, user_id, role)
      values (v_clan, v_user, 'leader');
  end if;

  update public.camps set updated_at = updated_at where user_id = v_user;
  return v_clan;
end;
$$;

revoke all on function public.ensure_owned_clan(text) from public, anon;
grant execute on function public.ensure_owned_clan(text) to authenticated;

create or replace function public.grant_paid_entitlement(
  p_event_id text,
  p_event_type text,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_payment_link_id text,
  p_claim_token text,
  p_sku text,
  p_amount_total bigint,
  p_currency text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.stripe_checkout_claims%rowtype;
begin
  if exists (select 1 from public.stripe_webhook_events where event_id = p_event_id) then
    return false;
  end if;

  select * into v_claim
    from public.stripe_checkout_claims
   where token = p_claim_token
   for update;
  if not found or v_claim.used_at is not null or v_claim.expires_at <= now() or v_claim.sku <> p_sku then
    raise exception 'invalid or expired checkout claim';
  end if;

  if p_sku = 'camp_marks_clan_01' and v_claim.target_type <> 'clan' then
    raise exception 'clan entitlement has a non-clan target';
  elsif p_sku <> 'camp_marks_clan_01' and v_claim.target_type <> 'player' then
    raise exception 'player entitlement has a non-player target';
  end if;

  update public.stripe_checkout_claims set used_at = now() where token = p_claim_token;

  if v_claim.target_type = 'clan' then
    insert into public.clan_entitlements (
      clan_id, sku, purchased_by, stripe_checkout_session_id,
      stripe_payment_intent_id, amount_total, currency
    ) values (
      v_claim.target_id, p_sku, v_claim.user_id, p_checkout_session_id,
      p_payment_intent_id, p_amount_total, p_currency
    ) on conflict (clan_id, sku) do nothing;
  else
    insert into public.player_entitlements (
      user_id, sku, stripe_checkout_session_id,
      stripe_payment_intent_id, amount_total, currency
    ) values (
      v_claim.target_id, p_sku, p_checkout_session_id,
      p_payment_intent_id, p_amount_total, p_currency
    ) on conflict (user_id, sku) do nothing;
  end if;

  insert into public.stripe_webhook_events (
    event_id, event_type, user_id, checkout_session_id, payment_link_id,
    target_type, target_id
  ) values (
    p_event_id, p_event_type, v_claim.user_id, p_checkout_session_id, p_payment_link_id,
    v_claim.target_type, v_claim.target_id
  );
  return true;
end;
$$;

revoke all on function public.grant_paid_entitlement(text, text, text, text, text, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.grant_paid_entitlement(text, text, text, text, text, text, text, bigint, text)
  to service_role;
