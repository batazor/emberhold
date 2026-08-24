create table public.stripe_checkout_claims (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  sku text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  used_at timestamptz,
  constraint stripe_checkout_claims_token check (token ~ '^[A-Za-z0-9_-]{20,200}$')
);

create table public.player_entitlements (
  user_id uuid not null references auth.users (id) on delete cascade,
  sku text not null,
  granted_at timestamptz not null default now(),
  stripe_checkout_session_id text not null,
  stripe_payment_intent_id text,
  amount_total bigint not null check (amount_total >= 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  primary key (user_id, sku),
  unique (stripe_checkout_session_id)
);

create table public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  checkout_session_id text not null,
  payment_link_id text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_checkout_claims enable row level security;
alter table public.player_entitlements enable row level security;
alter table public.stripe_webhook_events enable row level security;

create policy "players read own entitlements"
  on public.player_entitlements
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.stripe_checkout_claims from anon, authenticated;
revoke all on public.player_entitlements from anon, authenticated;
revoke all on public.stripe_webhook_events from anon, authenticated;
grant select on public.player_entitlements to authenticated;

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

  update public.stripe_checkout_claims
     set used_at = now()
   where token = p_claim_token;

  insert into public.player_entitlements (
    user_id,
    sku,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    amount_total,
    currency
  ) values (
    v_claim.user_id,
    p_sku,
    p_checkout_session_id,
    p_payment_intent_id,
    p_amount_total,
    p_currency
  ) on conflict (user_id, sku) do nothing;

  insert into public.stripe_webhook_events (
    event_id,
    event_type,
    user_id,
    checkout_session_id,
    payment_link_id
  ) values (
    p_event_id,
    p_event_type,
    v_claim.user_id,
    p_checkout_session_id,
    p_payment_link_id
  );
  return true;
end;
$$;

revoke all on function public.grant_paid_entitlement(text, text, text, text, text, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.grant_paid_entitlement(text, text, text, text, text, text, text, bigint, text)
  to service_role;
