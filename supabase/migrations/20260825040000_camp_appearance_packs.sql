-- Balance-neutral camp appearance: account fire/decor and clan heraldry.
alter table public.player_cosmetic_settings
  add column fire_style text not null default 'standard',
  add column decor_style text not null default 'none',
  add constraint player_cosmetic_settings_fire_style
    check (fire_style in ('standard', 'ghostfire', 'witchfire')),
  add constraint player_cosmetic_settings_decor_style
    check (decor_style in ('none', 'wayfarer', 'sentinel'));

alter table public.clans
  add column heraldry text not null default 'plain',
  add constraint clans_heraldry check (heraldry in ('plain', 'raven', 'sun'));

-- Fulfillment accepts the new clan-owned SKU while keeping every other SKU
-- account-owned. The claim still fixes the target before Checkout opens.
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

  if p_sku in ('camp_marks_clan_01', 'clan_heraldry_01') and v_claim.target_type <> 'clan' then
    raise exception 'clan entitlement has a non-clan target';
  elsif p_sku not in ('camp_marks_clan_01', 'clan_heraldry_01') and v_claim.target_type <> 'player' then
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
