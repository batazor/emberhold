-- SQL equality with NULL is NULL, but the client contract requires a boolean
-- for a player who does not belong to any clan yet.
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
    'alreadyMember', coalesce(v_current = v_clan, false),
    'canJoin', v_current is null or v_current = v_clan
  );
end;
$$;

revoke all on function public.preview_clan_invite(uuid) from public, anon;
grant execute on function public.preview_clan_invite(uuid) to authenticated;
