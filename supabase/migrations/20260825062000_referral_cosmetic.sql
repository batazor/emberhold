-- Referral links invite a new account into the game, independently of clans.
-- The opaque token identifies only the inviter and can be shared repeatedly.
create table public.game_referral_codes (
  inviter_user_id uuid primary key references auth.users (id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.game_referrals (
  invited_user_id uuid primary key references auth.users (id) on delete cascade,
  inviter_user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  constraint game_referrals_not_self check (invited_user_id <> inviter_user_id)
);

create index game_referrals_inviter on public.game_referrals (inviter_user_id, joined_at);

create table public.player_referral_rewards (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reward text not null default 'bond_beacon',
  unlocked_at timestamptz not null default now(),
  first_invited_user_id uuid references auth.users (id) on delete set null,
  constraint player_referral_rewards_reward check (reward = 'bond_beacon')
);

alter table public.game_referral_codes enable row level security;
alter table public.game_referrals enable row level security;
alter table public.player_referral_rewards enable row level security;
revoke all on public.game_referral_codes from anon, authenticated;
revoke all on public.game_referrals from anon, authenticated;
revoke all on public.player_referral_rewards from anon, authenticated;

alter table public.player_cosmetic_settings
  drop constraint player_cosmetic_settings_camp_icon,
  add constraint player_cosmetic_settings_camp_icon
    check (camp_icon in ('default', 'watchfire', 'horned_tent', 'bond_beacon'));
alter table public.camps
  drop constraint camps_camp_icon,
  add constraint camps_camp_icon
    check (camp_icon in ('default', 'watchfire', 'horned_tent', 'bond_beacon'));

create or replace function public.ensure_game_referral()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code public.game_referral_codes%rowtype;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  insert into public.game_referral_codes (inviter_user_id)
    values (v_user)
    on conflict (inviter_user_id) do update
      set inviter_user_id = excluded.inviter_user_id
    returning * into v_code;

  return jsonb_build_object('token', v_code.token::text);
end;
$$;

-- Only a genuinely new account can be attributed: its auth row must have
-- been created after the inviter generated the link. A recipient can reward
-- exactly one inviter, and reopening the link is idempotent.
create or replace function public.accept_game_referral(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_inviter uuid;
  v_code_created_at timestamptz;
  v_user_created_at timestamptz;
  v_awarded uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  select code.inviter_user_id, code.created_at
    into v_inviter, v_code_created_at
    from public.game_referral_codes code
   where code.token = p_token;
  if v_inviter is null or v_inviter = v_user then return false; end if;

  select users.created_at into v_user_created_at
    from auth.users users where users.id = v_user;
  if v_user_created_at < v_code_created_at then return false; end if;

  insert into public.game_referrals (invited_user_id, inviter_user_id)
    values (v_user, v_inviter)
    on conflict (invited_user_id) do nothing
    returning inviter_user_id into v_awarded;
  if v_awarded is null then return false; end if;

  insert into public.player_referral_rewards (user_id, first_invited_user_id)
    values (v_awarded, v_user)
    on conflict (user_id) do nothing;
  return true;
end;
$$;

revoke all on function public.ensure_game_referral() from public, anon;
revoke all on function public.accept_game_referral(uuid) from public, anon;
grant execute on function public.ensure_game_referral() to authenticated;
grant execute on function public.accept_game_referral(uuid) to authenticated;
