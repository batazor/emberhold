-- Telegram clan invitations are opaque, reusable links. The token carries no
-- clan identity by itself; only these security-definer RPCs can resolve it.
create table public.clan_invites (
  clan_id uuid primary key references public.clans (id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  constraint clan_invites_expiry check (expires_at > created_at)
);

alter table public.clan_invites enable row level security;
revoke all on public.clan_invites from anon, authenticated;

-- Every member may invite friends. Repeated taps return the same live link;
-- after thirty days the next tap rotates it without invalidating membership.
create or replace function public.ensure_clan_invite()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_clan uuid;
  v_invite public.clan_invites%rowtype;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  select membership.clan_id into v_clan
    from public.clan_memberships membership
   where membership.user_id = v_user;
  if v_clan is null then raise exception 'clan membership required'; end if;

  -- Lock the clan, not a possibly absent invite row, so concurrent first taps
  -- cannot create two links and return one that was immediately replaced.
  perform 1 from public.clans clan where clan.id = v_clan for update;
  select * into v_invite
    from public.clan_invites invite
   where invite.clan_id = v_clan and invite.expires_at > now();

  if not found then
    delete from public.clan_invites invite where invite.clan_id = v_clan;
    insert into public.clan_invites (clan_id, created_by)
      values (v_clan, v_user)
      returning * into v_invite;
  end if;

  return jsonb_build_object(
    'token', v_invite.token::text,
    'expiresAt', extract(epoch from v_invite.expires_at)
  );
end;
$$;

-- A token reveals only the small confirmation card required before joining.
create or replace function public.preview_clan_invite(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_clan uuid;
  v_name text;
  v_current uuid;
  v_members integer;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  select clan.id, clan.name into v_clan, v_name
    from public.clan_invites invite
    join public.clans clan on clan.id = invite.clan_id
   where invite.token = p_token
     and invite.expires_at > now()
     and clan.archived_at is null;
  if v_clan is null then return null; end if;

  select membership.clan_id into v_current
    from public.clan_memberships membership
   where membership.user_id = v_user;
  select count(*)::integer into v_members
    from public.clan_memberships membership
   where membership.clan_id = v_clan;

  return jsonb_build_object(
    'clanId', v_clan::text,
    'name', v_name,
    'memberCount', v_members,
    'alreadyMember', v_current = v_clan,
    'canJoin', v_current is null or v_current = v_clan
  );
end;
$$;

-- Membership has a unique(user_id) constraint, so accepting can never place a
-- player in two clans. The same link is idempotent for an existing member.
create or replace function public.accept_clan_invite(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_clan public.clans%rowtype;
  v_current uuid;
  v_role text;
  v_status text := 'joined';
begin
  if v_user is null then raise exception 'authentication required'; end if;

  select clan.* into v_clan
    from public.clan_invites invite
    join public.clans clan on clan.id = invite.clan_id
   where invite.token = p_token
     and invite.expires_at > now()
     and clan.archived_at is null;
  if v_clan.id is null then raise exception 'invalid or expired clan invitation'; end if;

  select membership.clan_id, membership.role into v_current, v_role
    from public.clan_memberships membership
   where membership.user_id = v_user;

  if v_current is not null and v_current <> v_clan.id then
    return jsonb_build_object('status', 'already_member');
  elsif v_current = v_clan.id then
    v_status := 'already_joined';
  else
    insert into public.clan_memberships (clan_id, user_id, role)
      values (v_clan.id, v_user, 'member');
    v_role := 'member';
    -- Re-run the camps normalization trigger so the public row immediately
    -- reflects the new canonical clan.
    update public.camps set updated_at = updated_at where user_id = v_user;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'clanId', v_clan.id::text,
    'name', v_clan.name,
    'role', v_role,
    'createdAt', extract(epoch from v_clan.created_at)
  );
end;
$$;

revoke all on function public.ensure_clan_invite() from public, anon;
revoke all on function public.preview_clan_invite(uuid) from public, anon;
revoke all on function public.accept_clan_invite(uuid) from public, anon;
grant execute on function public.ensure_clan_invite() to authenticated;
grant execute on function public.preview_clan_invite(uuid) to authenticated;
grant execute on function public.accept_clan_invite(uuid) to authenticated;
